#!/usr/bin/env node
/**
 * Exercises the upload path end to end against MinIO, including every rejection case.
 * The rejections are the point — an upload endpoint that only accepts is untested.
 */
import { createHash, randomBytes } from 'node:crypto';

import { PrismaClient } from '@prisma/client';
import sharp from 'sharp';

const BASE = process.argv[2] ?? 'http://localhost:3220';
const db = new PrismaClient();

const user = await db.user.findFirst({
  where: { status: 'ACTIVE', profile: { isNot: null } },
  include: { profile: true },
});
if (!user) process.exit(2);

await db.fileObject.deleteMany({ where: { ownerUserId: user.id } });
await db.profile.update({
  where: { id: user.profile.id },
  data: { photoKey: null, cvKey: null },
});

const rawToken = randomBytes(32).toString('base64url');
await db.session.create({
  data: {
    userId: user.id,
    tokenHash: createHash('sha256').update(rawToken).digest('hex'),
    expiresAt: new Date(Date.now() + 3600e3),
  },
});
const cookie = `__Host-fp_session=${rawToken}`;

const log = (...a) => console.log('  ', ...a);

async function post(kind, filename, buffer, type = 'application/octet-stream') {
  const form = new FormData();
  form.set('kind', kind);
  form.set('file', new Blob([buffer], { type }), filename);
  const res = await fetch(`${BASE}/api/upload`, {
    method: 'POST',
    headers: { cookie },
    body: form,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// ---- fixtures ----
// A real JPEG carrying EXIF, including GPS. The re-encode must strip it.
const jpegWithExif = await sharp({
  create: { width: 900, height: 600, channels: 3, background: { r: 30, g: 60, b: 120 } },
})
  .jpeg()
  .withMetadata({
    exif: {
      IFD0: { Copyright: 'Test', Artist: 'Somebody' },
      GPS: { GPSLatitudeRef: 'N', GPSLongitudeRef: 'E' },
    },
  })
  .toBuffer();

const realPdf = Buffer.concat([
  Buffer.from('%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\n', 'ascii'),
  Buffer.alloc(2048, 0x20),
  Buffer.from('\n%%EOF\n', 'ascii'),
]);

const phpDisguisedAsJpg = Buffer.from('<?php system($_GET["c"]); ?>\n', 'ascii');
const hugeJpeg = await sharp({
  create: { width: 6000, height: 6000, channels: 3, background: { r: 255, g: 0, b: 0 } },
}).jpeg({ quality: 100 }).toBuffer();

console.log('\n── ACCEPTED ──');

const photo = await post('photo', 'headshot.jpg', jpegWithExif, 'image/jpeg');
log('photo upload:', photo.status, photo.body.contentType, `${photo.body.bytes} bytes`);

// EXIF stripped?
if (photo.body.url) {
  const fetched = Buffer.from(await (await fetch(photo.body.url)).arrayBuffer());
  const meta = await sharp(fetched).metadata();
  log('stored format:', meta.format, `${meta.width}x${meta.height}`);
  // Parsed metadata, not a byte search. EXIF tag NAMES are encoded numerically, so
  // `buffer.includes('GPSLatitudeRef')` is always false and proves nothing — a vacuous
  // assertion that survived two reviews here before being caught.
  const sourceHadExif = (await sharp(jpegWithExif).metadata()).exif !== undefined;
  log('source carried EXIF:', sourceHadExif, '(must be true, or the test proves nothing)');
  log('EXIF stripped:', meta.exif === undefined, '(must be true)');
  log('re-encoded to webp:', meta.format === 'webp');
  log('resized to square:', meta.width === 512 && meta.height === 512);
}

const cv = await post('cv', 'my-cv.pdf', realPdf, 'application/pdf');
log('cv upload:', cv.status, cv.body.contentType, `${cv.body.bytes} bytes`);

console.log('\n── REJECTED ──');

const cases = [
  ['.php renamed to .jpg', () => post('photo', 'shell.jpg', phpDisguisedAsJpg, 'image/jpeg')],
  ['PDF submitted as a photo', () => post('photo', 'doc.jpg', realPdf, 'image/jpeg')],
  ['image submitted as a CV', () => post('cv', 'pic.pdf', jpegWithExif, 'application/pdf')],
  // NOTE: rejected by magic-byte sniffing (UNREADABLE_TYPE), not by the %PDF- header
  // check — that branch is unreachable. See the comment in lib/uploads.ts.
  ['non-PDF bytes named .pdf', () => post('cv', 'fake.pdf', Buffer.from('NOTAPDF' + 'x'.repeat(500)), 'application/pdf')],
  ['empty file', () => post('photo', 'empty.jpg', Buffer.alloc(0), 'image/jpeg')],
  ['oversized image', () => post('photo', 'huge.jpg', Buffer.concat([hugeJpeg, Buffer.alloc(6 * 1024 * 1024)]), 'image/jpeg')],
  ['unknown kind', () => post('avatar', 'x.jpg', jpegWithExif, 'image/jpeg')],
];

for (const [name, run] of cases) {
  const r = await run();
  const ok = r.status >= 400;
  log(`${ok ? 'rejected' : 'ACCEPTED — PROBLEM'}  ${String(r.status).padEnd(4)} ${name}`);
  if (r.body.error) log(`            → ${r.body.error}`);
}

console.log('\n── UNAUTHENTICATED ──');
const noAuth = await fetch(`${BASE}/api/upload`, { method: 'POST', body: new FormData() });
log('without a session cookie:', noAuth.status, '(must be 401)');

console.log('\n── STATE ──');
const after = await db.profile.findUnique({
  where: { id: user.profile.id },
  select: { photoKey: true, cvKey: true, completeness: true },
});
log('profile.photoKey set:', Boolean(after.photoKey));
log('profile.cvKey set:', Boolean(after.cvKey));
log('completeness recomputed:', after.completeness);

const files = await db.fileObject.findMany({
  where: { ownerUserId: user.id },
  select: { key: true, mimeType: true, sizeBytes: true, originalName: true },
});
log('FileObject rows:', files.length);
files.forEach((f) => log(`   ${f.mimeType} ${f.sizeBytes}b  key=${f.key}`));
log('keys contain no original filename:', !files.some((f) => f.key.includes('headshot') || f.key.includes('my-cv')));

console.log('\n── REPLACEMENT sweeps the old object ──');
const firstKey = after.photoKey;
const replaced = await post('photo', 'new.jpg', jpegWithExif, 'image/jpeg');
const afterReplace = await db.profile.findUnique({
  where: { id: user.profile.id },
  select: { photoKey: true },
});
log('new key differs:', firstKey !== afterReplace.photoKey);
const oldStillThere = await fetch(`${BASE.replace(/:\d+$/, ':9000')}/faculty-portal-media/${firstKey}`);
log('old object deleted from storage:', oldStillThere.status === 404, `(HTTP ${oldStillThere.status})`);
const orphanRows = await db.fileObject.count({ where: { key: firstKey } });
log('old FileObject row removed:', orphanRows === 0);
void replaced;

await db.session.deleteMany({
  where: { tokenHash: createHash('sha256').update(rawToken).digest('hex') },
});
await db.$disconnect();
