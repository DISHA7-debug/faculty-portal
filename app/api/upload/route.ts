import { NextResponse } from 'next/server';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { requireSession, UnauthenticatedError } from '@/lib/auth/session';
import { recomputeCompleteness } from '@/lib/completeness';
import { db } from '@/lib/db';
import { clientIpFromHeaders } from '@/lib/request-ip';
import { RULES, enforce, ipKey } from '@/lib/rate-limit';
import { buildKey, getPublicUrl, remove, upload } from '@/lib/storage';
import { isOverQuota, processUpload, type UploadKind } from '@/lib/uploads';

/**
 * File upload endpoint.
 *
 * A Route Handler rather than a Server Action, deliberately: Server Actions serialise
 * their arguments through the RSC protocol, which is a poor fit for multi-megabyte
 * binaries, and a Route Handler gives direct access to the request stream, real HTTP
 * status codes, and ordinary progress reporting in the browser.
 *
 * Order of checks, and every one of them matters:
 *
 *   1. requireSession        — who is asking?
 *   2. assertOwnsProfileRow  — may they write to THIS profile?
 *   3. rate limit            — is this host flooding us?
 *   4. quota                 — has this account had its share?
 *   5. size / magic bytes / re-encode  (lib/uploads.ts)
 *   6. storage write, THEN the database row
 *
 * Step 6's ordering is the subtle one. Writing the FileObject row first would leave a row
 * pointing at an object that does not exist if the upload then failed; writing storage
 * first leaves at worst an orphaned object, which is invisible to users and cheap to
 * sweep. Prefer the failure that is not user-visible.
 */

export const runtime = 'nodejs'; // sharp is a native module; not available on edge
export const dynamic = 'force-dynamic';

const KINDS: readonly UploadKind[] = ['photo', 'cv'];

function bad(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status });
}

export async function POST(request: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (error) {
    if (error instanceof UnauthenticatedError) return bad(401, 'Sign in to upload files.');
    throw error;
  }

  // The profile being written to is the session's own. It is routed through the same
  // ownership helper as every other mutation so this endpoint is not a special case —
  // and so scripts/check-ownership.mjs sees it.
  await assertOwnsProfileRow({ profileId: session.profileId }, session);

  const ip = clientIpFromHeaders(request.headers);
  const limit = await enforce(ipKey('upload', ip), RULES.uploadPerUser, 'closed');
  if (!limit.allowed) {
    return bad(429, 'Too many uploads. Try again shortly.', {
      retryAfterSeconds: limit.retryAfterSeconds,
    });
  }

  if (await isOverQuota(session.userId)) {
    return bad(
      413,
      'You have reached the file limit for this account. Delete an old file first.',
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) return bad(400, 'Expected a multipart form upload.');

  const kind = String(form.get('kind') ?? '') as UploadKind;
  if (!KINDS.includes(kind)) return bad(400, 'Unknown upload kind.');

  const file = form.get('file');
  if (!(file instanceof File)) return bad(400, 'No file was provided.');

  const input = Buffer.from(await file.arrayBuffer());

  // Size, magic bytes, and re-encode. The client's declared MIME type is never consulted.
  const processed = await processUpload(kind, input);
  if (!processed.ok) {
    return bad(415, processed.message, { reason: processed.reason });
  }

  const key = buildKey(session.userId, kind, processed.file.extension);

  // Storage first — see the note above about which failure is preferable.
  await upload({
    key,
    body: processed.file.body,
    contentType: processed.file.contentType,
  });

  // Replacing an existing photo or CV: capture the old key so it can be swept after the
  // profile points at the new one.
  const profile = await db.profile.findUnique({
    where: { id: session.profileId },
    select: { photoKey: true, cvKey: true },
  });
  const previousKey = kind === 'photo' ? profile?.photoKey : profile?.cvKey;

  await db.$transaction([
    db.fileObject.create({
      data: {
        key,
        ownerUserId: session.userId,
        // Recorded for support and audit only. Never used to build a path or a
        // Content-Type — see buildKey().
        originalName: file.name.slice(0, 255),
        mimeType: processed.file.contentType,
        sizeBytes: processed.file.bytes,
      },
    }),
    db.profile.update({
      where: { id: session.profileId },
      data: kind === 'photo' ? { photoKey: key } : { cvKey: key },
    }),
  ]);

  // Old object removed only AFTER the profile points at the new one, so a failure here
  // leaves an orphan rather than a broken reference.
  if (previousKey && previousKey !== key) {
    await remove(previousKey).catch((error) => {
      console.error('[upload] failed to remove replaced object', previousKey, error);
    });
    await db.fileObject.deleteMany({ where: { key: previousKey } });
  }

  await recomputeCompleteness(session.profileId);

  return NextResponse.json({
    ok: true,
    key,
    url: getPublicUrl(key),
    bytes: processed.file.bytes,
    contentType: processed.file.contentType,
  });
}
