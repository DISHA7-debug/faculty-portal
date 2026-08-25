import { randomUUID } from 'node:crypto';

import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

/**
 * The single object-storage adapter. ALL uploads go through here — no route imports the
 * S3 SDK directly (CLAUDE.md §4, adapter rule), so the provider stays swappable.
 *
 * Dev and production run the SAME code path against the same SDK. Only configuration
 * differs:
 *
 *   development  MinIO from docker-compose.yml, path-style, http://localhost:9000
 *   production   Cloudflare R2, path-style, https://<account>.r2.cloudflarestorage.com
 *
 * R2 is S3-compatible, which is the whole reason MinIO is a faithful stand-in: the storage
 * path is exercised locally rather than staying unverified until cutover.
 */

let cached: S3Client | null = null;

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value?.trim()) throw new Error(`${key} is not set — cannot use object storage.`);
  return value;
}

export function s3(): S3Client {
  cached ??= new S3Client({
    // R2 ignores region but the SDK requires one; 'auto' is what R2's own docs use.
    region: process.env.R2_REGION ?? 'auto',
    endpoint: requiredEnv('R2_ENDPOINT'),
    credentials: {
      accessKeyId: requiredEnv('R2_ACCESS_KEY_ID'),
      secretAccessKey: requiredEnv('R2_SECRET_ACCESS_KEY'),
    },
    // MinIO requires path-style; R2 accepts it. Virtual-host style would try to resolve
    // <bucket>.localhost, which fails in development in a confusing way.
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  });
  return cached;
}

export function bucket(): string {
  return requiredEnv('R2_BUCKET');
}

/**
 * Builds the object key.
 *
 * The original filename is DISCARDED (docs/SECURITY.md §5). A user-supplied name is a path
 * traversal risk, a content-type spoofing hint, and a way to leak information — someone's
 * CV is not improved by being stored as `resume_final_v3_DONTSHARE.pdf`.
 *
 * Prefixing with the owner's id keeps one person's objects together, which makes both the
 * per-user quota and a future "delete everything for this account" trivial to express.
 */
export function buildKey(
  userId: string,
  kind: 'photo' | 'cv',
  extension: string,
): string {
  return `${userId}/${kind}/${randomUUID()}.${extension}`;
}

export type UploadInput = {
  key: string;
  body: Buffer;
  contentType: string;
  /** Seconds. Long for immutable objects, since keys are unguessable and never reused. */
  cacheSeconds?: number;
};

export async function upload({
  key,
  body,
  contentType,
  cacheSeconds = 31_536_000,
}: UploadInput): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: bucket(),
      Key: key,
      Body: body,
      // Set from OUR sniffed value, never from the client's declared type.
      ContentType: contentType,
      CacheControl: `public, max-age=${cacheSeconds}, immutable`,
    }),
  );
}

/** Idempotent: deleting an absent key is not an error in S3. */
export async function remove(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

/**
 * Public URL for a stored object.
 *
 * Object KEYS are stored in the database, never URLs (PROJECT_PLAN §4.3), so the storage
 * provider or CDN hostname can change without a data migration.
 */
export function getPublicUrl(key: string): string {
  const base = requiredEnv('R2_PUBLIC_URL').replace(/\/$/, '');
  return `${base}/${key}`;
}
