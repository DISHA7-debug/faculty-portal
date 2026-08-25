import nodemailer, { type Transporter } from 'nodemailer';

/**
 * The single outbound-email adapter. ALL email goes through here — no route imports
 * nodemailer directly (CLAUDE.md §4, adapter rule), so the provider stays swappable.
 *
 * Dev and production run the SAME code path. The only difference is configuration:
 *
 *   development  SMTP_HOST=localhost SMTP_PORT=1025   -> Mailpit (docker compose),
 *                no auth, no TLS. Read what was sent at http://localhost:8025
 *   production   SMTP_HOST=email-smtp.<region>.amazonaws.com SMTP_PORT=587
 *                -> Amazon SES (or college SMTP), STARTTLS + credentials.
 *
 * Nothing here branches on NODE_ENV to decide *how* to send. It branches only on
 * whether credentials were supplied, which is a property of the config, not the
 * environment. That keeps the dev path honest: if it works against Mailpit it works
 * against SES, because it is the same transport code.
 */

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain-text body. Always provide one — some clients never render HTML. */
  text: string;
  html?: string;
  replyTo?: string;
};

let cachedTransport: Transporter | null = null;

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value?.trim()) {
    throw new Error(`${key} is not set — cannot send email.`);
  }
  return value;
}

function buildTransport(): Transporter {
  const host = requiredEnv('SMTP_HOST');
  const port = Number(process.env.SMTP_PORT ?? 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD?.trim();

  if (Number.isNaN(port)) {
    throw new Error(`SMTP_PORT is not a number: ${process.env.SMTP_PORT}`);
  }

  return nodemailer.createTransport({
    host,
    port,
    // 465 is implicit TLS; 587 and 1025 negotiate via STARTTLS if offered.
    secure: port === 465,
    // Only attach credentials when they exist. Mailpit accepts none; SES requires them.
    auth: user && pass ? { user, pass } : undefined,
    // Do not silently downgrade to plaintext against a real provider. Mailpit is
    // reached over localhost, so requiring TLS there would break the dev sink.
    requireTLS: port !== 1025 && Boolean(user && pass),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
  });
}

/** Lazily constructed so importing this module never opens a socket. */
export function getTransport(): Transporter {
  cachedTransport ??= buildTransport();
  return cachedTransport;
}

/**
 * Sends one message. Throws on failure — callers decide whether a failed email is
 * fatal (signup verification) or merely logged (an admin notification).
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const from = requiredEnv('MAIL_FROM');

  await getTransport().sendMail({
    from,
    to: message.to,
    subject: message.subject,
    text: message.text,
    html: message.html,
    replyTo: message.replyTo,
  });
}

/**
 * Connection check for diagnostics and the deployment smoke test.
 * Returns rather than throws so a caller can report status without a try/catch.
 */
export async function verifyMailConnection(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  try {
    await getTransport().verify();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Test seam: forces the next call to rebuild the transport from current env. */
export function resetTransportForTesting(): void {
  cachedTransport = null;
}
