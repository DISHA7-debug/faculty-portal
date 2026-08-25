#!/usr/bin/env node
/**
 * Fails the build if a deployment hostname is hardcoded in source.
 *
 * No domain is registered yet (docs/CUTOVER.md). Every hostname must come from the
 * environment, so that pointing this stack at the real college domain later is a
 * config change and not a code change. This check is what keeps that true — without
 * it, one `https://faculty.college.ac.in` pasted into a component silently survives
 * cutover and breaks in a way nobody notices until a link 404s in production.
 *
 * Allowed to contain hostnames:
 *   .env.example   the documented template of what to set
 *   docs/          prose, including CUTOVER.md which must name the real steps
 *   README.md, CLAUDE.md
 *
 * Everything else must use process.env / Caddy's {$VAR} substitution.
 *
 * Usage: npm run check:hostnames
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Directories never worth scanning. */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'out',
  'build',
  'coverage',
  'docs', // prose is allowed to name real hostnames
]);

/** Files exempt because their whole job is to document or template hostnames. */
const ALLOWED_FILES = new Set([
  '.env.example',
  'README.md',
  'CLAUDE.md',
  'scripts/check-hostnames.mjs', // this file necessarily contains the patterns
  'package-lock.json',
  'audit-allowlist.json', // advisory URLs
]);

const SCAN_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.yml', '.yaml', '.sql', '.sh', '.css',
]);

/** Extensionless files that still matter. */
const SCAN_FILENAMES = new Set(['Dockerfile', 'Caddyfile', '.dockerignore']);

/**
 * Deployment-infrastructure hostnames. Deliberately narrow: matching every FQDN
 * would flag documentation links (nextjs.org, github.com) and produce noise that
 * trains people to ignore the check.
 */
const PATTERNS = [
  {
    // The original placeholder domain from the starter template.
    re: /yourcollege(?:\.[a-z.]+)?/gi,
    why: 'placeholder college domain — read it from SITE_ADDRESS / R2_PUBLIC_URL instead',
  },
  {
    // Any .ac.in host — what the real deployment will use.
    re: /\b[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.ac\.in\b/gi,
    why: 'college domain hardcoded — must come from env (docs/CUTOVER.md)',
  },
  {
    re: /\b[a-z0-9][a-z0-9-]*\.amazonaws\.com\b/gi,
    why: 'SES/AWS endpoint hardcoded — must come from SMTP_HOST',
  },
  {
    re: /\b[a-z0-9][a-z0-9-]*\.r2\.cloudflarestorage\.com\b/gi,
    why: 'R2 endpoint hardcoded — must come from R2_ENDPOINT',
  },
];

/** Per-line opt-out marker. Grep for it to audit every use. */
const IGNORE_DIRECTIVE = 'hostname-check-ignore';

/** Hosts that are legitimately fixed: loopback and container-network service names. */
const EXEMPT_LITERALS = [
  /^localhost$/i,
  /^127\.0\.0\.1$/,
  /^0\.0\.0\.0$/,
  /example\.invalid$/i, // RFC 2606 reserved, cannot resolve
];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example' && entry.name !== '.dockerignore') {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    yield full;
  }
}

function shouldScan(relPath, name) {
  if (ALLOWED_FILES.has(relPath)) return false;
  if (SCAN_FILENAMES.has(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot !== -1 && SCAN_EXTENSIONS.has(name.slice(dot));
}

const findings = [];

for await (const file of walk(ROOT)) {
  const rel = relative(ROOT, file);
  const name = file.split('/').pop();
  if (!shouldScan(rel, name)) continue;

  const info = await stat(file);
  if (info.size > 2 * 1024 * 1024) continue;

  const content = await readFile(file, 'utf8');
  const lines = content.split('\n');

  for (const { re, why } of PATTERNS) {
    for (const [index, line] of lines.entries()) {
      // Explicit per-line escape hatch, for the rare case where a hostname-shaped
      // string is data rather than a destination — e.g. the placeholder markers in
      // lib/env.ts that exist precisely to be detected. Deliberately per-line and
      // greppable rather than a file-level exemption, so each use stays visible.
      if (line.includes(IGNORE_DIRECTIVE)) continue;

      re.lastIndex = 0;
      let match;
      while ((match = re.exec(line)) !== null) {
        const hit = match[0];
        if (EXEMPT_LITERALS.some((x) => x.test(hit))) continue;
        findings.push({ file: rel, line: index + 1, hit, why, text: line.trim() });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(`Hardcoded hostname check FAILED — ${findings.length} occurrence(s):\n`);
  for (const f of findings) {
    console.error(`  ✗ ${f.file}:${f.line}  "${f.hit}"`);
    console.error(`      ${f.why}`);
    console.error(`      ${f.text.slice(0, 110)}`);
  }
  console.error(
    '\nHostnames must be read from the environment so cutover is config-only.' +
      '\nIf this is prose, move it under docs/. See docs/CUTOVER.md.',
  );
  process.exit(1);
}

console.log('Hardcoded hostname check passed — no deployment hostnames in source.');
