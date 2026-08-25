import { fileTypeFromBuffer } from 'file-type';
import sharp from 'sharp';

import { db } from '@/lib/db';

/**
 * Upload validation and processing — docs/SECURITY.md §5.
 *
 * Everything here runs BEFORE a byte reaches storage. The ordering matters: size, then
 * magic bytes, then re-encode. Checking cheaply first means a 50 MB payload is rejected
 * without ever being handed to an image decoder.
 */

export const MAX_IMAGE_BYTES = Number(process.env.MAX_IMAGE_MB ?? 5) * 1024 * 1024;
export const MAX_PDF_BYTES = Number(process.env.MAX_PDF_MB ?? 10) * 1024 * 1024;
export const MAX_FILES_PER_USER = Number(process.env.MAX_FILES_PER_USER ?? 60);

/** Photo output. Square, and small enough that a directory grid stays fast on 4G. */
export const PHOTO_SIZE = 512;

export type UploadKind = 'photo' | 'cv';

export type ValidationFailure =
  | 'EMPTY'
  | 'TOO_LARGE'
  | 'UNREADABLE_TYPE'
  | 'DISALLOWED_TYPE'
  | 'CORRUPT_IMAGE'
  | 'PDF_HEADER'
  | 'QUOTA_EXCEEDED';

export type ProcessedUpload = {
  body: Buffer;
  contentType: string;
  extension: string;
  bytes: number;
};

export type ProcessResult =
  | { ok: true; file: ProcessedUpload }
  | { ok: false; reason: ValidationFailure; message: string };

/**
 * Types accepted per kind, by SNIFFED mime — never by extension or the client's header.
 *
 * A `.php` renamed to `.jpg` is the canonical test (docs/SECURITY.md §12), and the only
 * defence that catches it is reading the actual bytes.
 */
const ALLOWED: Record<UploadKind, readonly string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  cv: ['application/pdf'],
};

const MAX_BYTES: Record<UploadKind, number> = {
  photo: MAX_IMAGE_BYTES,
  cv: MAX_PDF_BYTES,
};

/**
 * Per-user object quota, counted from FileObject rows.
 *
 * Bounds what one account can cost in storage. Counted against the OWNER rather than
 * globally so one prolific user cannot deny space to everybody else.
 */
export async function isOverQuota(userId: string): Promise<boolean> {
  const count = await db.fileObject.count({ where: { ownerUserId: userId } });
  return count >= MAX_FILES_PER_USER;
}

/**
 * Validates and normalises an upload.
 *
 * Images are RE-ENCODED rather than passed through. That is the important step: it strips
 * EXIF (including GPS coordinates, which phones attach by default and which a faculty
 * member has no idea are in their photo), discards any appended payload, and guarantees
 * the output is genuinely the image type claimed — a polyglot file that is both valid JPEG
 * and valid script does not survive being decoded and re-encoded.
 */
export async function processUpload(
  kind: UploadKind,
  input: Buffer,
): Promise<ProcessResult> {
  if (input.byteLength === 0) {
    return { ok: false, reason: 'EMPTY', message: 'That file is empty.' };
  }

  // 1. SIZE FIRST — cheapest check, and it bounds the cost of everything after it.
  const limit = MAX_BYTES[kind];
  if (input.byteLength > limit) {
    const mb = Math.round(limit / (1024 * 1024));
    return {
      ok: false,
      reason: 'TOO_LARGE',
      message: `That file is larger than ${mb} MB.`,
    };
  }

  // 2. MAGIC BYTES — what the file IS, not what it claims to be.
  const sniffed = await fileTypeFromBuffer(input);
  if (!sniffed) {
    return {
      ok: false,
      reason: 'UNREADABLE_TYPE',
      message: 'We could not identify that file type.',
    };
  }

  if (!ALLOWED[kind].includes(sniffed.mime)) {
    return {
      ok: false,
      reason: 'DISALLOWED_TYPE',
      message:
        kind === 'photo'
          ? 'Photos must be JPEG, PNG, or WebP.'
          : 'Your CV must be a PDF.',
    };
  }

  if (kind === 'cv') {
    // 3a. Literal %PDF- header check.
    //
    // CURRENTLY UNREACHABLE, and kept deliberately. `file-type` reports application/pdf
    // only when the buffer already begins with %PDF-, so by the time control arrives here
    // the condition below cannot be true. It is retained as defence in depth against a
    // future version of that library loosening its PDF detection (offset tolerance, for
    // instance), which would otherwise silently remove this guarantee.
    //
    // Do not write a test claiming to exercise this branch — one did, and it was actually
    // exercising UNREADABLE_TYPE. If you need it covered, stub the sniffer.
    if (input.subarray(0, 5).toString('ascii') !== '%PDF-') {
      return {
        ok: false,
        reason: 'PDF_HEADER',
        message: 'That file does not look like a valid PDF.',
      };
    }

    // PDFs are stored as-is. Re-encoding a PDF safely needs a full parser, which is a
    // larger attack surface than the problem it solves; the mitigation is that they are
    // served from a separate origin as a download, never rendered inline by us.
    return {
      ok: true,
      file: {
        body: input,
        contentType: 'application/pdf',
        extension: 'pdf',
        bytes: input.byteLength,
      },
    };
  }

  // 3b. RE-ENCODE the image. This is what strips EXIF and any embedded payload.
  try {
    const output = await sharp(input, { failOn: 'error' })
      .rotate() // honour EXIF orientation BEFORE the metadata is discarded
      .resize(PHOTO_SIZE, PHOTO_SIZE, { fit: 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();

    return {
      ok: true,
      file: {
        body: output,
        contentType: 'image/webp',
        extension: 'webp',
        bytes: output.byteLength,
      },
    };
  } catch {
    // A file that sniffs as an image but will not decode is either corrupt or crafted.
    return {
      ok: false,
      reason: 'CORRUPT_IMAGE',
      message: 'That image could not be processed. Try a different file.',
    };
  }
}
