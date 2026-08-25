import assert from 'node:assert/strict';
import { randomInt } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { AccountStatus } from '@prisma/client';

import { requestLoginCode, verifyLoginCode } from '@/lib/auth/config';
import { generateOtpCode, OTP_MAX_ATTEMPTS } from '@/lib/auth/otp';
import { signup } from '@/lib/auth/signup';
import { consumeOtp, issueToken } from '@/lib/auth/tokens';
import sharp from 'sharp';

import { assertOwnsProfileRow } from '@/lib/auth/ownership';
import { processUpload } from '@/lib/uploads';
import { createSession, getOptionalSession } from '@/lib/auth/session';
import { db } from '@/lib/db';
import { redis } from '@/lib/redis';

/**
 * End-to-end auth flow against REAL Postgres, Redis, and Mailpit.
 *
 * Separate from the unit suite (`npm test`) because it needs live services. CI runs the
 * unit suite only; this is `npm run test:integration` locally.
 *
 * These assertions are about behaviour the unit tests structurally cannot reach: that the
 * token really is single-use under concurrency, that mail really arrives, and that the
 * status machine really refuses to skip the approval gate.
 */

const MAILPIT = 'http://localhost:8025';
const DOMAIN = process.env.ALLOWED_EMAIL_DOMAINS?.split(',')[0]?.trim() ?? 'faculty.example.invalid';

/** Unique per run so repeated runs never collide. */
const stamp = Date.now();
const EMAIL = `sprint2.test.${stamp}@${DOMAIN}`;
/**
 * Fresh synthetic IPs per run.
 *
 * The rate limiter is real and its windows are hours long, so reusing a fixed IP makes
 * the second run of this file fail with RATE_LIMITED — which is the limiter working, not
 * a bug. Randomising the source keeps each run independent without weakening the limits
 * or reaching into Redis to clear them.
 */
const randomIp = () =>
  `10.${randomInt(1, 254)}.${randomInt(1, 254)}.${randomInt(1, 254)}`;
const IP = randomIp();

let departmentId: string;
const createdUserIds: string[] = [];

async function mailpitSearch(query: string) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  return (await res.json()) as { messages: Array<{ ID: string; Subject: string }> };
}

async function mailpitBody(id: string): Promise<string> {
  const res = await fetch(`${MAILPIT}/api/v1/message/${id}`);
  const msg = (await res.json()) as { Text?: string; HTML?: string };
  return `${msg.Text ?? ''}\n${msg.HTML ?? ''}`;
}

function extractToken(body: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  assert.ok(match, 'email must contain a token link');
  return match[1];
}

before(async () => {
  const dept = await db.department.findFirst({ select: { id: true } });
  assert.ok(dept, 'seed the database first: npm run db:seed');
  departmentId = dept.id;
  await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

  // Remove residue from any earlier interrupted run of this file.
  await db.user.deleteMany({ where: { email: { startsWith: 'sprint2.test.' } } });
});

after(async () => {
  if (createdUserIds.length > 0) {
    await db.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await redis.quit().catch(() => {});
  await db.$disconnect();
});

describe('timing equalisation (fix: existence oracle)', () => {
  /** Median rather than mean, so one GC pause cannot decide the result. */
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)];
  };

  it('registered and unregistered addresses take indistinguishable time', async () => {
    const SAMPLES = 5;

    // Each address is probed at most twice across the whole test. That matters: the
    // per-email soft throttle escalates on repeated requests for the SAME address, so
    // hammering one registered address would measure the throttle rather than the
    // existence branch. (The throttle is attacker-caused and identical either way, so it
    // is not itself an existence oracle — but it does swamp the measurement.)
    const registeredEmails: string[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const email = `timing.reg.${stamp}.${i}@${DOMAIN}`;
      await signup(
        { fullName: `Dr. Timing Reg ${i}`, email, departmentId },
        randomIp(),
      );
      registeredEmails.push(email);
    }
    const created = await db.user.findMany({
      where: { email: { in: registeredEmails } },
      select: { id: true },
    });
    created.forEach((u) => createdUserIds.push(u.id));
    assert.equal(created.length, SAMPLES, 'setup: all registered accounts exist');

    const registered: number[] = [];
    const unregistered: number[] = [];

    // Interleaved so machine-load drift affects both arms equally.
    for (let i = 0; i < SAMPLES; i++) {
      const t0 = performance.now();
      await signup(
        {
          fullName: `Dr. Timing Reg ${i}`,
          email: registeredEmails[i],
          departmentId,
        },
        randomIp(),
      );
      registered.push(performance.now() - t0);

      const t1 = performance.now();
      await signup(
        {
          fullName: `Dr. Timing New ${i}`,
          email: `timing.new.${stamp}.${i}@${DOMAIN}`,
          departmentId,
        },
        randomIp(),
      );
      unregistered.push(performance.now() - t1);
    }

    const fresh = await db.user.findMany({
      where: { email: { startsWith: `timing.new.${stamp}.` } },
      select: { id: true },
    });
    fresh.forEach((u) => createdUserIds.push(u.id));

    const mRegistered = median(registered);
    const mUnregistered = median(unregistered);
    const ratio =
      Math.max(mRegistered, mUnregistered) / Math.min(mRegistered, mUnregistered);

    // Before the fix, the existing-user branch skipped argon2 (~19 MiB) and slug
    // derivation entirely, making this ratio several-fold and measurable over a network.
    // Both paths now perform the same work before branching.
    assert.ok(
      ratio < 1.6,
      `timing must not distinguish existence: registered=${mRegistered.toFixed(1)}ms ` +
        `unregistered=${mUnregistered.toFixed(1)}ms ratio=${ratio.toFixed(2)}`,
    );

    // Sanity: argon2 is actually running on both paths, not uniformly skipped.
    assert.ok(mRegistered > 5, 'argon2 should dominate both paths');
  });
});

describe('slug collision (fix: swallowed signups)', () => {
  it('two DIFFERENT people with the same name both get accounts', async () => {
    const name = `Dr. Samename Collision ${stamp}`;
    const a = `collide.a.${stamp}@${DOMAIN}`;
    const b = `collide.b.${stamp}@${DOMAIN}`;

    // Concurrent, so both derive the same slug root before either inserts.
    const [ra, rb] = await Promise.all([
      signup({ fullName: name, email: a, departmentId }, randomIp()),
      signup({ fullName: name, email: b, departmentId }, randomIp()),
    ]);

    assert.deepEqual(ra, { ok: true }, 'first signup must succeed');
    assert.deepEqual(rb, { ok: true }, 'second signup must succeed, not be swallowed');

    const users = await db.user.findMany({
      where: { email: { in: [a, b] } },
      include: { profile: true },
    });
    users.forEach((u) => createdUserIds.push(u.id));

    // The regression: one caller was told ok:true while no account existed.
    assert.equal(users.length, 2, 'BOTH accounts must exist — neither silently dropped');
    const slugs = users.map((u) => u.profile?.slug);
    assert.equal(new Set(slugs).size, 2, `slugs must differ, got ${slugs.join(', ')}`);
  });
});

describe('ownership against REAL database rows', () => {
  /**
   * The unit tests inject a stub department loader. This exercises the production path:
   * assertOwnsProfileRow resolving the owning profile's department from the database.
   */
  it('a FACULTY session gets 404 for another profile’s education row', async () => {
    const [a, b] = await db.profile.findMany({ take: 2, select: { id: true, departmentId: true } });
    assert.ok(a && b, 'seed the database first');

    const foreignRow = await db.education.create({
      data: { profileId: b.id, degree: 'Ph.D.', level: 'PHD', institution: 'Elsewhere' },
      select: { id: true, profileId: true },
    });

    const sessionForA = {
      sessionId: 's', userId: 'u', profileId: a.id, role: 'FACULTY' as const,
      status: AccountStatus.ACTIVE, departmentId: a.departmentId,
      administersDepartmentId: null, expiresAt: new Date(Date.now() + 1000),
    };

    await assert.rejects(
      () => assertOwnsProfileRow(foreignRow, sessionForA),
      (e: unknown) => {
        const digest = (e as { digest?: string }).digest ?? '';
        assert.ok(digest.includes('404'), `expected a 404, got ${digest}`);
        return true;
      },
      'a faculty member must not reach another profile’s row',
    );

    await db.education.delete({ where: { id: foreignRow.id } });
  });

  it('a DEPT_ADMIN out of scope gets 404 via the REAL department lookup', async () => {
    const depts = await db.department.findMany({ take: 2, select: { id: true } });
    const target = await db.profile.findFirst({
      where: { departmentId: depts[1].id },
      select: { id: true },
    });
    assert.ok(target, 'seed needs a profile in the second department');

    const row = await db.education.create({
      data: { profileId: target.id, degree: 'M.Tech.', level: 'MASTERS', institution: 'Elsewhere' },
      select: { id: true, profileId: true },
    });

    // Administers department[0]; the row belongs to a profile in department[1].
    const adminSession = {
      sessionId: 's', userId: 'u', profileId: 'other', role: 'DEPT_ADMIN' as const,
      status: AccountStatus.ACTIVE, departmentId: depts[1].id, // self-edited, must be ignored
      administersDepartmentId: depts[0].id,
      expiresAt: new Date(Date.now() + 1000),
    };

    await assert.rejects(
      () => assertOwnsProfileRow(row, adminSession),
      (e: unknown) => {
        assert.ok(String((e as { digest?: string }).digest ?? '').includes('404'));
        return true;
      },
      'department scope must be resolved from the OWNING profile, not the session',
    );

    await db.education.delete({ where: { id: row.id } });
  });
});

describe('DOI uniqueness against the REAL Postgres constraint', () => {
  /** Verifies the assumptions the friendly-conflict handling is built on. */
  it('two publications with NULL doi coexist — NULLs are distinct in Postgres', async () => {
    const profile = await db.profile.findFirst({ select: { id: true } });
    assert.ok(profile);

    const a = await db.publication.create({
      data: { profileId: profile.id, type: 'JOURNAL', title: 'No DOI paper A', authors: 'X', doi: null },
      select: { id: true },
    });
    const b = await db.publication.create({
      data: { profileId: profile.id, type: 'JOURNAL', title: 'No DOI paper B', authors: 'Y', doi: null },
      select: { id: true },
    });

    assert.ok(a.id && b.id, 'both DOI-less publications must be insertable');

    await db.publication.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });

  it('an EMPTY STRING doi would collide — which is why the schema maps it to null', async () => {
    const profile = await db.profile.findFirst({ select: { id: true } });
    assert.ok(profile);

    const first = await db.publication.create({
      data: { profileId: profile.id, type: 'JOURNAL', title: 'Empty doi A', authors: 'X', doi: '' },
      select: { id: true },
    });

    // This is the exact failure the .transform() prevents: '' is a value, not an absence.
    await assert.rejects(
      db.publication.create({
        data: { profileId: profile.id, type: 'JOURNAL', title: 'Empty doi B', authors: 'Y', doi: '' },
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'P2002');
        return true;
      },
      'two empty-string DOIs must collide — proving why empty must become NULL',
    );

    await db.publication.delete({ where: { id: first.id } });
  });

  it('a genuine duplicate DOI raises P2002 naming the doi column', async () => {
    const profile = await db.profile.findFirst({ select: { id: true } });
    assert.ok(profile);
    const doi = `10.1234/dup.${Date.now()}`;

    const first = await db.publication.create({
      data: { profileId: profile.id, type: 'JOURNAL', title: 'Original paper', authors: 'X', doi },
      select: { id: true },
    });

    await assert.rejects(
      db.publication.create({
        data: { profileId: profile.id, type: 'JOURNAL', title: 'Duplicate paper', authors: 'Y', doi },
      }),
      (error: unknown) => {
        const e = error as { code?: string; meta?: { target?: unknown } };
        assert.equal(e.code, 'P2002');
        const target = Array.isArray(e.meta?.target) ? e.meta.target.join(',') : String(e.meta?.target);
        assert.match(target.toLowerCase(), /doi/, 'meta.target must name doi so the handler can tell conflicts apart');
        return true;
      },
    );

    await db.publication.delete({ where: { id: first.id } });
  });
});

describe('email OTP against real services', () => {
  const otpEmail = `otp.test.${stamp}@${DOMAIN}`;

  async function latestCodeFor(address: string): Promise<string> {
    const found = await mailpitSearch(address);
    assert.ok(found.messages.length > 0, 'a code email must have been sent');
    const body = await mailpitBody(found.messages[0].ID);
    const match = /\b(\d{3})\s?(\d{3})\b/.exec(body);
    assert.ok(match, 'the email must contain a 6-digit code');
    return `${match[1]}${match[2]}`;
  }

  it('signup sends a code and creates a PENDING_VERIFICATION account', async () => {
    await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' }).catch(() => {});

    const result = await signup(
      { fullName: 'Dr. Otp Test', email: otpEmail, departmentId },
      randomIp(),
    );
    assert.deepEqual(result, { ok: true });

    const user = await db.user.findUnique({
      where: { email: otpEmail },
      include: { profile: true },
    });
    assert.ok(user);
    createdUserIds.push(user.id);
    assert.equal(user.status, AccountStatus.PENDING_VERIFICATION);
    assert.ok(user.profile, 'profile created atomically with the user');

    assert.match(await latestCodeFor(otpEmail), /^\d{6}$/);
  });

  it('the raw code is never stored — only a keyed digest', async () => {
    const code = await latestCodeFor(otpEmail);
    const user = await db.user.findUnique({ where: { email: otpEmail } });
    const token = await db.verificationToken.findFirst({
      where: { userId: user!.id, type: 'LOGIN_OTP' },
    });
    assert.ok(token);
    assert.notEqual(token.tokenHash, code);
    assert.ok(!token.tokenHash.includes(code), 'the code must not appear in the digest');
    assert.equal(token.tokenHash.length, 64);
  });

  it('a WRONG code is rejected and burns one attempt', async () => {
    const user = await db.user.findUnique({ where: { email: otpEmail } });
    const before = await db.verificationToken.findFirst({
      where: { userId: user!.id, type: 'LOGIN_OTP' },
      select: { attempts: true },
    });

    const wrong = await verifyLoginCode(otpEmail, '000000', randomIp());
    assert.equal(wrong.ok, false);

    const after = await db.verificationToken.findFirst({
      where: { userId: user!.id, type: 'LOGIN_OTP' },
      select: { attempts: true },
    });
    assert.equal(after!.attempts, before!.attempts + 1, 'the attempt must be counted');
  });

  it('the CORRECT code signs in and advances PENDING_VERIFICATION → PENDING_APPROVAL', async () => {
    const code = await latestCodeFor(otpEmail);
    const result = await verifyLoginCode(otpEmail, code, randomIp());

    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.firstSignIn, true);
      assert.equal(
        result.status,
        AccountStatus.PENDING_APPROVAL,
        'a code must never advance an account straight to ACTIVE',
      );
    }

    const user = await db.user.findUnique({ where: { email: otpEmail } });
    assert.equal(user!.status, AccountStatus.PENDING_APPROVAL);
    assert.ok(user!.emailVerifiedAt, 'the code doubles as email verification');

    const sessions = await db.session.count({ where: { userId: user!.id } });
    assert.ok(sessions > 0, 'a database-backed session must exist — not a JWT');
  });

  it('the same code cannot be used twice', async () => {
    const code = await latestCodeFor(otpEmail);
    assert.equal((await verifyLoginCode(otpEmail, code, randomIp())).ok, false);
  });

  it('exhausting the attempt cap DESTROYS the code', async () => {
    const user = await db.user.findUnique({ where: { email: otpEmail } });
    const realCode = generateOtpCode();
    await issueToken(user!.id, 'LOGIN_OTP', realCode);

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await verifyLoginCode(otpEmail, realCode === '111111' ? '222222' : '111111', randomIp());
    }

    const remaining = await db.verificationToken.count({
      where: { userId: user!.id, type: 'LOGIN_OTP' },
    });
    assert.equal(remaining, 0, 'the code must be destroyed, not merely rejected');

    // Even the RIGHT code is now useless — which is exactly the point.
    assert.equal((await verifyLoginCode(otpEmail, realCode, randomIp())).ok, false);
  });

  it('issuing a new code invalidates the previous one', async () => {
    const user = await db.user.findUnique({ where: { email: otpEmail } });
    const first = generateOtpCode();
    await issueToken(user!.id, 'LOGIN_OTP', first);
    const second = generateOtpCode();
    await issueToken(user!.id, 'LOGIN_OTP', second);

    assert.equal(
      await db.verificationToken.count({ where: { userId: user!.id, type: 'LOGIN_OTP' } }),
      1,
      'only one live code per user',
    );
    assert.equal((await consumeOtp(user!.id, first)).ok, false, 'superseded code must fail');
    void second;
  });

  it('requesting a code for an UNKNOWN address still reports success', async () => {
    const result = await requestLoginCode(`nobody.${stamp}@${DOMAIN}`, randomIp());
    assert.deepEqual(result, { ok: true }, 'must not reveal that the account is unknown');
  });
});

describe('server-side image enforcement (the cropper is not a control)', () => {
  /**
   * The client cropper is a convenience for choosing framing. It is NOT what guarantees
   * output dimensions — anything a browser produces is attacker-controlled, and the
   * endpoint is reachable directly with curl. These upload shapes the cropper would never
   * produce and assert sharp squares them anyway.
   */
  const shapes: Array<[string, number, number]> = [
    ['wide panorama', 1600, 400],
    ['tall portrait', 400, 1600],
    ['tiny square', 64, 64],
    ['single pixel', 1, 1],
    ['already 512', 512, 512],
  ];

  for (const [name, width, height] of shapes) {
    it(`squares a ${name} (${width}x${height}) to 512x512`, async () => {
      const input = await sharp({
        create: { width, height, channels: 3, background: { r: 10, g: 20, b: 30 } },
      })
        .jpeg()
        .toBuffer();

      const result = await processUpload('photo', input);
      assert.equal(result.ok, true, `${name} should be accepted`);
      if (!result.ok) return;

      const meta = await sharp(result.file.body).metadata();
      assert.equal(meta.width, 512, `${name}: width must be forced to 512`);
      assert.equal(meta.height, 512, `${name}: height must be forced to 512`);
      assert.equal(meta.format, 'webp', `${name}: must be re-encoded to webp`);
    });
  }

  it('strips EXIF including GPS, whatever the client sent', async () => {
    const withGps = await sharp({
      create: { width: 900, height: 300, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      // sharp's Exif type exposes the IFD blocks; GPS lives in the same EXIF segment and
      // is removed by the same code path, so testing IFD0 covers it. What matters is that
      // an EXIF block exists on the way in and does not on the way out.
      .withMetadata({
        exif: { IFD0: { Copyright: 'Someone', Artist: 'Someone', Software: 'TestCam' } },
      })
      .toBuffer();

    // Assert on PARSED metadata, not on a literal string in the bytes. EXIF encodes tag
    // names numerically, so `buffer.includes('GPSLatitudeRef')` is always false and any
    // test written that way passes vacuously while proving nothing. An earlier version of
    // the container verification made exactly that mistake.
    const before = await sharp(withGps).metadata();
    assert.ok(before.exif !== undefined, 'fixture must actually carry an EXIF block');
    assert.ok(before.exif.length > 0, 'fixture EXIF must be non-empty');

    const result = await processUpload('photo', withGps);
    assert.equal(result.ok, true);
    if (!result.ok) return;

    const after = await sharp(result.file.body).metadata();
    assert.equal(after.exif, undefined, 'EXIF must not survive the re-encode');
    assert.ok(
      result.file.body.length < withGps.length || after.exif === undefined,
      'the re-encoded image must not carry the original metadata block',
    );
  });

  it('a WebP masquerading as a crop is still re-encoded and squared', async () => {
    // Exactly what a tampered client would post: correct type, wrong dimensions.
    const fake = await sharp({
      create: { width: 2000, height: 100, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .webp()
      .toBuffer();

    const result = await processUpload('photo', fake);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const meta = await sharp(result.file.body).metadata();
    assert.equal(meta.width, 512);
    assert.equal(meta.height, 512);
  });
});
