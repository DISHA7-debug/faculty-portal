#!/usr/bin/env node
/**
 * Enforces docs/SECURITY.md §1.4: every mutating handler must reach an ownership check.
 *
 * The rule this protects is CLAUDE.md §3.1 — a mutation that verifies only "is logged in"
 * lets any faculty member edit any other's records by changing an ID. That is the most
 * exploitable bug class in this application, and it is a bug of OMISSION: nothing fails,
 * no test breaks, and the feature works perfectly for the person who wrote it.
 *
 * Conventions only hold if they are enforced mechanically. This runs in CI.
 *
 * ── What counts as a mutating handler ───────────────────────────────────────────
 *   - every exported async function in a file carrying the 'use server' directive
 *   - every exported POST / PUT / PATCH / DELETE in an app/api route handler
 *
 * ── What counts as reaching the check ───────────────────────────────────────────
 * The function body mentions one of the ownership helpers, OR calls a helper defined in
 * the same file whose body does (one level of indirection, so a small local helper is
 * allowed without forcing the check to be inlined everywhere).
 *
 * Anything that writes a profile-owned row but genuinely cannot check ownership must be
 * listed in ownership-allowlist.json with a reason. That file is the audit trail.
 *
 * ── Known limitation ────────────────────────────────────────────────────────────
 * Detection is by top-level model call: `db.education.update(`, `tx.publication.delete(`.
 * A nested write reached through a NON-profile-owned model — for example
 * `db.user.update({ data: { profile: { update: ... } } })` — is not detected. Nested
 * writes through a profile-owned model still are, because the outer call matches.
 * If that pattern ever becomes common, this needs a real AST pass.
 *
 * Usage: npm run check:ownership
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join(ROOT, 'ownership-allowlist.json');

/** Names that satisfy the requirement. */
const OWNERSHIP_HELPERS = [
  'assertOwnsProfileRow',
  'assertOwnsProfile',
  'assertCanAdminister',
  'assertCanPublishProfile',
];

const MUTATING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

const WRITE_VERBS = [
  'create', 'createMany', 'createManyAndReturn',
  'update', 'updateMany', 'updateManyAndReturn',
  'upsert', 'delete', 'deleteMany',
];

/**
 * Which models are PROFILE-OWNED, derived from prisma/schema.prisma rather than hardcoded.
 *
 * The rule being enforced is specifically about rows belonging to a profile, so that is
 * what the detector looks for. Two earlier attempts were wrong in opposite directions:
 * scanning for any Prisma write flagged read helpers, and scanning only the handler's own
 * file classified the auth actions as read-only because their writes happen inside lib/.
 *
 * Deriving the list from the schema means a new repeatable section is enrolled the moment
 * its model gains a profileId — nobody has to remember to update this script.
 */
async function profileOwnedModels() {
  const schema = await readFile(join(ROOT, 'prisma', 'schema.prisma'), 'utf8');
  const models = new Set(['profile']);
  const re = /model\s+([A-Za-z0-9_]+)\s*\{([\s\S]*?)\n\}/g;
  let m;
  while ((m = re.exec(schema)) !== null) {
    if (/\bprofileId\b/.test(m[2])) {
      models.add(m[1][0].toLowerCase() + m[1].slice(1));
    }
  }
  return models;
}

const PROFILE_MODELS = await profileOwnedModels();

/** e.g. `db.education.update(`, `tx.publication.deleteMany(` */
const PROFILE_WRITE_RE = new RegExp(
  `\\.(${[...PROFILE_MODELS].join('|')})\\s*\\.\\s*(${WRITE_VERBS.join('|')})\\s*\\(`,
);

/** Raw SQL is opaque to this detector, so it is treated as a write. Fail closed. */
const RAW_WRITE_RE = /\$executeRaw|\$executeRawUnsafe/;

const SKIP_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'build', 'coverage']);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else yield full;
  }
}

/**
 * Extracts a function body by brace matching from the first `{` after `startIndex`.
 * Deliberately simple: this only needs to be accurate enough to tell whether an
 * identifier appears inside one function versus a neighbouring one.
 */
function extractBody(source, startIndex) {
  const open = source.indexOf('{', startIndex);
  if (open === -1) return '';
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  return source.slice(open);
}

/** Finds exported async functions and their bodies. */
function findExportedFunctions(source) {
  const found = [];
  const re = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    found.push({ name: m[1], body: extractBody(source, m.index) });
  }
  // `export const x = async (...) => {`
  const re2 = /export\s+const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=\s*(?:async\s*)?\(/g;
  while ((m = re2.exec(source)) !== null) {
    found.push({ name: m[1], body: extractBody(source, m.index) });
  }
  return found;
}

/** Local (non-exported) functions, so one level of indirection is allowed. */
function findLocalFunctions(source) {
  const map = new Map();
  const re = /(?:^|\n)\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    map.set(m[1], extractBody(source, m.index));
  }
  return map;
}

function mentionsHelper(body) {
  return OWNERSHIP_HELPERS.some((helper) => body.includes(helper));
}

/** True if this body, or a local function it calls, writes a profile-owned row. */
function performsWrite(body, localFns, seen = new Set()) {
  if (PROFILE_WRITE_RE.test(body) || RAW_WRITE_RE.test(body)) return true;
  for (const [name, localBody] of localFns) {
    if (seen.has(name)) continue;
    if (!new RegExp(`\\b${name}\\s*\\(`).test(body)) continue;
    seen.add(name);
    if (performsWrite(localBody, localFns, seen)) return true;
  }
  return false;
}

function reachesOwnership(body, localFns, seen = new Set()) {
  if (mentionsHelper(body)) return true;
  for (const [name, localBody] of localFns) {
    if (seen.has(name)) continue;
    // Only follow a local function this body actually calls.
    if (!new RegExp(`\\b${name}\\s*\\(`).test(body)) continue;
    seen.add(name);
    if (reachesOwnership(localBody, localFns, seen)) return true;
  }
  return false;
}

const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'));
const allowed = new Map(
  allowlist.allow.map((entry) => [`${entry.file}#${entry.handler}`, entry]),
);
const usedAllowlistKeys = new Set();

const violations = [];
const checked = [];
const readOnly = [];
const crossRefViolations = [];

/**
 * Directory -> the single Prisma model its actions file may touch.
 *
 * The section action files share a shape, so the likely defect is not a missing ownership
 * check but a WRONG MODEL: a handler that loads a Position to check ownership and then
 * writes to db.award. The check above cannot see that — both models are profile-owned, so
 * every rule it enforces is satisfied while the mutation lands on the wrong table.
 *
 * Asserting one model per file, matching its location, closes that. A file that genuinely
 * needs two models must be split, which is the right answer anyway: the ownership check
 * has to be legible per entity.
 */
const DIRECTORY_MODEL = {
  'academics/actions.ts': 'education',
  'publications/actions.ts': 'publication',
  'positions/actions.ts': 'position',
  'positions/membership-actions.ts': 'membership',
  'awards/actions.ts': 'award',
  'teaching/actions.ts': 'course',
  'projects/actions.ts': 'researchProject',
  'guidance/actions.ts': 'guidance',
};

for await (const file of walk(join(ROOT, 'app'))) {
  if (!/\.(ts|tsx)$/.test(file)) continue;
  const rel = relative(ROOT, file);

  const info = await stat(file);
  if (info.size > 1024 * 1024) continue;

  const source = await readFile(file, 'utf8');

  const isServerActionFile = /^\s*['"]use server['"]/m.test(source);
  const isRouteHandler = /(^|\/)route\.tsx?$/.test(rel);
  if (!isServerActionFile && !isRouteHandler) continue;

  const localFns = findLocalFunctions(source);

  // ---- cross-reference: one profile-owned model per actions file, matching its path ----
  const expectedKey = Object.keys(DIRECTORY_MODEL).find((suffix) =>
    rel.endsWith(suffix.replace('/', '/')),
  );
  if (expectedKey) {
    const expected = DIRECTORY_MODEL[expectedKey];
    const referenced = new Set();
    const modelRe = new RegExp(
      `\\b(?:db|tx)\\s*\\.\\s*(${[...PROFILE_MODELS].join('|')})\\s*\\.`,
      'g',
    );
    let mm;
    while ((mm = modelRe.exec(source)) !== null) referenced.add(mm[1]);

    // `profile` is expected: recomputeCompleteness writes it from every section.
    referenced.delete('profile');

    if (referenced.size === 0) {
      crossRefViolations.push(
        `${rel}: references no profile-owned model — expected ${expected}`,
      );
    } else if (referenced.size > 1) {
      crossRefViolations.push(
        `${rel}: references ${referenced.size} profile-owned models (${[...referenced].join(', ')}) — expected exactly ${expected}. Split the file.`,
      );
    } else if (!referenced.has(expected)) {
      crossRefViolations.push(
        `${rel}: writes db.${[...referenced][0]} but its location says ${expected} — wrong model.`,
      );
    }
  }

  for (const fn of findExportedFunctions(source)) {
    // In a route handler only the mutating verbs matter; GET is a read.
    if (isRouteHandler && !MUTATING_METHODS.includes(fn.name)) continue;

    const key = `${rel}#${fn.name}`;

    // Not a write to a profile-owned row. Recorded and printed so the classification is
    // auditable rather than an invisible skip.
    if (!performsWrite(fn.body, localFns)) {
      readOnly.push(key);
      continue;
    }

    checked.push(key);

    if (allowed.has(key)) {
      usedAllowlistKeys.add(key);
      continue;
    }

    if (!reachesOwnership(fn.body, localFns)) {
      violations.push({ file: rel, handler: fn.name });
    }
  }
}

const staleAllowlist = [...allowed.keys()].filter((k) => !usedAllowlistKeys.has(k));

console.log(
  `Ownership check — ${checked.length} profile-owned mutation(s) inspected\n` +
    `Profile-owned models (from schema.prisma): ${[...PROFILE_MODELS].sort().join(', ')}\n`,
);

if (usedAllowlistKeys.size > 0) {
  console.log(`Exempt (${usedAllowlistKeys.size}) — see ownership-allowlist.json:`);
  for (const key of usedAllowlistKeys) {
    console.log(`  · ${key} — ${allowed.get(key).reason}`);
  }
  console.log('');
}

/**
 * The gap is printed on every run, not buried in a comment.
 *
 * Sprint 4's admin approval is expected to take exactly the undetected shape — a
 * `db.user.update` carrying a nested profile update — so this warning needs to be in
 * front of whoever writes it, at the moment they run the check.
 */
console.log('Detector limitation — read this when adding admin handlers:');
console.log('  Writes are detected by TOP-LEVEL model call, e.g. db.education.update(.');
console.log('  A nested write reached through a model that is NOT profile-owned —');
console.log('    db.user.update({ data: { profile: { update: ... } } })');
console.log('  is NOT detected, and such a handler will pass this check unguarded.');
console.log('  Sprint 4 approve/reject/suspend is the likely first case. Either route the');
console.log('  write through the profile-owned model, or add the ownership check by hand');
console.log('  and confirm it — do not assume a green check means it was verified.\n');

if (readOnly.length > 0) {
  console.log(
    `No profile-owned write detected, so not required to check ownership (${readOnly.length}):`,
  );
  for (const key of readOnly) console.log(`  · ${key}`);
  console.log(
    '  If any of these writes a row belonging to a Profile, this detector missed it.\n',
  );
}

if (staleAllowlist.length > 0) {
  console.log('Stale allowlist entries — handler no longer exists, remove them:');
  for (const key of staleAllowlist) console.log(`  · ${key}`);
  console.log('');
}

if (crossRefViolations.length > 0) {
  console.error(
    `FAILED — ${crossRefViolations.length} actions file(s) touching the wrong model:\n`,
  );
  for (const v of crossRefViolations) console.error(`  ✗ ${v}`);
  console.error(
    '\nEach section actions file must reference exactly one profile-owned model, matching' +
      '\nits directory. A handler that checks ownership on one model and writes another' +
      '\npasses every other rule here while corrupting the wrong table.',
  );
  process.exit(1);
}

if (violations.length > 0) {
  console.error(`FAILED — ${violations.length} mutating handler(s) with no ownership check:\n`);
  for (const v of violations) {
    console.error(`  ✗ ${v.file}  →  ${v.handler}()`);
  }
  console.error(
    `\nEvery mutation on a profile-owned row must call one of: ${OWNERSHIP_HELPERS.join(', ')}.` +
      `\nSee CLAUDE.md §3.1 and docs/SECURITY.md §1.1.` +
      `\nIf this handler genuinely touches no profile-owned row, add it to` +
      `\nownership-allowlist.json with a reason.`,
  );
  process.exit(1);
}

console.log('PASSED — every mutating handler reaches an ownership check.');
