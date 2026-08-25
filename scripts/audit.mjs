#!/usr/bin/env node
/**
 * Dependency audit gate for CI.
 *
 * Wraps `npm audit --audit-level=high` with an explicit, reviewed allowlist so that
 * an accepted finding is recorded as a decision with a justification and an expiry,
 * rather than silently waved through by lowering the severity threshold.
 *
 * Exit codes:
 *   0  no unaccepted findings at or above the threshold
 *   1  unaccepted findings, or an allowlist entry past its review date
 *   2  the audit itself could not be run
 *
 * Usage: npm run audit
 */
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_PATH = join(ROOT, 'audit-allowlist.json');
const THRESHOLD = ['high', 'critical'];

/** `npm audit` exits non-zero when it finds anything, so capture stdout either way. */
async function runAudit() {
  try {
    const { stdout } = await execFileAsync('npm', ['audit', '--json'], {
      cwd: ROOT,
      maxBuffer: 32 * 1024 * 1024,
    });
    return JSON.parse(stdout);
  } catch (error) {
    if (error.stdout) {
      try {
        return JSON.parse(error.stdout);
      } catch {
        /* fall through */
      }
    }
    console.error('Could not run `npm audit`:', error.message);
    process.exit(2);
  }
}

function advisoryIdFromUrl(url) {
  const match = /\/advisories\/(GHSA-[\w-]+)/.exec(url ?? '');
  return match?.[1] ?? null;
}

const audit = await runAudit();
const allowlist = JSON.parse(await readFile(ALLOWLIST_PATH, 'utf8'));
const allowed = new Map(allowlist.allow.map((e) => [e.advisory, e]));

const today = new Date().toISOString().slice(0, 10);
const problems = [];
const accepted = [];
const seenAdvisories = new Set();

for (const [name, vuln] of Object.entries(audit.vulnerabilities ?? {})) {
  if (!THRESHOLD.includes(vuln.severity)) continue;

  const advisories = (vuln.via ?? [])
    .filter((v) => typeof v === 'object')
    .map((v) => ({ id: advisoryIdFromUrl(v.url), title: v.title, url: v.url }));

  // A package can be flagged purely for depending on something else vulnerable;
  // those carry no advisory of their own, so resolve them through their `via` chain.
  const ids = advisories.map((a) => a.id).filter(Boolean);
  const viaNames = (vuln.via ?? []).filter((v) => typeof v === 'string');

  if (ids.length === 0 && viaNames.length > 0) {
    // Transitively affected. Accepted only if every upstream advisory is accepted.
    const upstreamAccepted = viaNames.every((n) =>
      allowlist.allow.some((e) => e.packages?.includes(n) || e.packages?.includes(name)),
    );
    if (upstreamAccepted) {
      accepted.push(`${name} (${vuln.severity}, via ${viaNames.join(', ')})`);
      continue;
    }
    problems.push(
      `${name} (${vuln.severity}) — transitively vulnerable via ${viaNames.join(', ')}; no allowlist entry.`,
    );
    continue;
  }

  for (const adv of advisories) {
    if (!adv.id) {
      problems.push(`${name} (${vuln.severity}) — ${adv.title ?? 'unknown advisory'} (no GHSA id parsed).`);
      continue;
    }
    seenAdvisories.add(adv.id);
    const entry = allowed.get(adv.id);

    if (!entry) {
      problems.push(`${name} (${vuln.severity}) — ${adv.id}: ${adv.title}\n      ${adv.url}`);
      continue;
    }
    if (entry.reviewBy < today) {
      problems.push(
        `${name} — ${adv.id} allowlist entry EXPIRED on ${entry.reviewBy}. ` +
          `Re-review it: ${entry.reviewAction ?? 'no action recorded'}`,
      );
      continue;
    }
    accepted.push(`${name} (${vuln.severity}) — ${adv.id}, review by ${entry.reviewBy}`);
  }
}

const stale = allowlist.allow.filter((e) => !seenAdvisories.has(e.advisory));

console.log('Dependency audit (threshold: high)\n');

if (accepted.length > 0) {
  console.log(`Accepted findings (${accepted.length}) — see audit-allowlist.json:`);
  for (const a of accepted) console.log(`  · ${a}`);
  console.log('');
}

if (stale.length > 0) {
  console.log('Stale allowlist entries — no longer reported, safe to delete:');
  for (const e of stale) console.log(`  · ${e.advisory} (${e.packages?.join(', ')})`);
  console.log('');
}

if (problems.length > 0) {
  console.error(`FAILED — ${problems.length} finding(s) needing action:\n`);
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    '\nFix the dependency, or add a reviewed entry to audit-allowlist.json.' +
      '\nDo not lower --audit-level.',
  );
  process.exit(1);
}

const counts = audit.metadata?.vulnerabilities ?? {};
console.log(
  `PASSED — no unaccepted high or critical findings. ` +
    `(raw npm audit: ${counts.high ?? 0} high, ${counts.critical ?? 0} critical)`,
);
