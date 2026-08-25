#!/usr/bin/env node
/**
 * Uploads through the CONTAINERISED app, via Caddy over TLS, to containerised MinIO.
 *
 * The point is sharp: it is a native module, and "works on my Mac" says nothing about
 * whether it loads and executes inside an Alpine image. This is the exact class of failure
 * the local production-stack run exists to catch.
 *
 * A session is inserted straight into the container's database, because signing in would
 * need a code from email and that is not what is being tested here.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';

import sharp from 'sharp';

const BASE = process.argv[2] ?? 'https://localhost';
const COMPOSE = ['-f', 'docker-compose.prod.yml', '-f', 'docker-compose.verify.yml'];

function psql(sql) {
  return execFileSync(
    'docker',
    ['compose', ...COMPOSE, 'exec', '-T', 'postgres', 'psql', '-U', 'faculty', '-d', 'faculty_portal', '-tAc', sql],
    { encoding: 'utf8' },
  ).trim();
}

const log = (...a) => console.log('  ', ...a);

// ---- mint a session inside the container's database ----
const userId = psql(`SELECT id FROM "User" WHERE status='ACTIVE' AND role='FACULTY' LIMIT 1;`);
if (!userId) {
  console.error('No ACTIVE faculty in the container database. Seed it first.');
  process.exit(2);
}
const raw = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(raw).digest('hex');
psql(
  `INSERT INTO "Session" (id, "userId", "tokenHash", "expiresAt", "createdAt")
   VALUES ('verify-${Date.now()}', '${userId}', '${hash}', now() + interval '1 hour', now());`,
);
const cookie = `__Host-fp_session=${raw}`;

// ---- a NON-SQUARE JPEG carrying EXIF including GPS ----
const source = await sharp({
  create: { width: 1200, height: 400, channels: 3, background: { r: 20, g: 90, b: 60 } },
})
  .jpeg()
  .withMetadata({
    exif: { IFD0: { Copyright: 'Container Test', Artist: 'Somebody', Software: 'TestCam' } },
  })
  .toBuffer();

const sourceMeta = await sharp(source).metadata();
log(`source image: ${sourceMeta.width}x${sourceMeta.height} ${sourceMeta.format}, EXIF present: ${sourceMeta.exif !== undefined}`);

// ---- upload through Caddy into the container ----
const form = new FormData();
form.set('kind', 'photo');
form.set('file', new Blob([source], { type: 'image/jpeg' }), 'wide.jpg');

const res = await fetch(`${BASE}/api/upload`, {
  method: 'POST',
  headers: { cookie },
  body: form,
});
const body = await res.json().catch(() => ({}));
log('upload status:', res.status, JSON.stringify(body.contentType ?? body.error ?? ''));

if (res.status !== 200) {
  console.error('\n  UPLOAD FAILED INSIDE THE CONTAINER — sharp is the prime suspect.');
  console.error('  ', JSON.stringify(body));
  process.exit(1);
}

// ---- read the stored object back OUT of container MinIO ----
//
// Fetched over HTTP from INSIDE the network rather than off MinIO's disk: MinIO keeps its
// own on-disk layout, and going through the S3 API also proves the app container can
// actually reach storage — which is half of what this verification is for.
const key = body.key;
const stored = execFileSync(
  'docker',
  [
    'compose', ...COMPOSE, 'exec', '-T', 'app',
    'node', '-e',
    `fetch('http://minio:9000/faculty-portal-media/${key}')` +
      `.then(r=>r.arrayBuffer()).then(b=>process.stdout.write(Buffer.from(b)))`,
  ],
  { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 },
);

const meta = await sharp(stored).metadata();
log(`stored object: ${meta.width}x${meta.height} ${meta.format}, ${stored.length} bytes`);
log('re-encoded to webp:', meta.format === 'webp');
log('squared to 512x512:', meta.width === 512 && meta.height === 512);
// Parsed metadata, not a byte search: EXIF tag names are encoded numerically, so
// searching the buffer for 'GPSLatitudeRef' always returns false and proves nothing.
log('source carried EXIF:', sourceMeta.exif !== undefined);
log('EXIF stripped from stored object:', meta.exif === undefined);

const dbKey = psql(`SELECT "photoKey" FROM "Profile" WHERE "userId"='${userId}';`);
log('profile.photoKey written:', dbKey === key);

const rows = psql(`SELECT count(*) FROM "FileObject" WHERE key='${key}';`);
log('FileObject row written:', rows === '1');

// ---- a rejection, inside the container ----
const bad = new FormData();
bad.set('kind', 'photo');
bad.set('file', new Blob([Buffer.from('<?php system($_GET["c"]); ?>')], { type: 'image/jpeg' }), 'shell.jpg');
const badRes = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: { cookie }, body: bad });
log('php-as-jpg rejected in container:', badRes.status, `(${(await badRes.json()).error})`);

psql(`DELETE FROM "Session" WHERE "tokenHash"='${hash}';`);

const allGood =
  meta.format === 'webp' &&
  meta.width === 512 &&
  meta.height === 512 &&
  meta.exif === undefined &&
  sourceMeta.exif !== undefined &&
  dbKey === key &&
  badRes.status >= 400;

console.log(allGood ? '\n  RESULT: sharp works on Alpine; the full path is verified in-container' : '\n  RESULT: PROBLEM');
process.exit(allGood ? 0 : 1);
