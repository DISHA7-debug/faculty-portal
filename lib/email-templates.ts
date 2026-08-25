import type { MailMessage } from '@/lib/mailer';

/**
 * Transactional email bodies.
 *
 * Plain text is always populated. HTML is a progressive enhancement — institutional mail
 * clients strip or mangle it often enough that a text-only fallback carrying the full link
 * is the difference between a faculty member completing signup and giving up.
 *
 * Deliberately minimal markup: no external images, no web fonts, no tracking pixels.
 * Anything loaded from a remote host is what pushes a message into spam, and the whole
 * onboarding flow depends on these landing in an inbox (docs/CUTOVER.md §3).
 */

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ?? 'http://localhost:3000';
}

/** Shared shell. Inline styles only — <style> blocks are stripped by several clients. */
function layout(heading: string, bodyHtml: string): string {
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#FAFAF8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1F1F1D;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#FFFFFE;border:1px solid #E8E8E3;border-radius:10px;">
    <tr><td style="padding:28px 28px 8px;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;line-height:1.3;">${heading}</h1>
      ${bodyHtml}
    </td></tr>
    <tr><td style="padding:8px 28px 24px;border-top:1px solid #F0F0EC;">
      <p style="margin:16px 0 0;font-size:12px;color:#6B6B63;line-height:1.5;">
        If you did not expect this email you can ignore it &mdash; no action will be taken.
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:0 0 20px;">
    <a href="${href}" style="display:inline-block;padding:11px 20px;background:#2C3159;color:#FFFFFE;text-decoration:none;border-radius:7px;font-weight:500;font-size:14px;">${label}</a>
  </p>`;
}

export function loginCodeEmail(to: string, code: string): MailMessage {
  const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;

  return {
    to,
    // The code is IN the subject line. Most people read it from the notification and never
    // open the message, which is the fastest path and one fewer chance to mistype.
    subject: `${spaced} is your sign-in code`,
    text: [
      `Your sign-in code is ${spaced}`,
      '',
      'Enter it on the sign-in page. The code expires in 10 minutes and can be used once.',
      '',
      'If you did not ask to sign in, ignore this email. Somebody may have mistyped their',
      'own address — no action is needed and nobody can sign in without this code.',
    ].join('\n'),
    html: layout(
      'Your sign-in code',
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.55;">
         Enter this code on the sign-in page:
       </p>
       <p style="margin:0 0 20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
                 font-size:32px;letter-spacing:0.12em;font-weight:600;color:#2C3159;">
         ${spaced}
       </p>
       <p style="margin:0;font-size:13px;color:#6B6B63;line-height:1.55;">
         The code expires in <strong>10 minutes</strong> and can be used once. If you did
         not ask to sign in, ignore this email — nobody can sign in without the code.
       </p>`,
    ),
  };
}

/** Sent once an administrator approves the account. */
export function approvalEmail(to: string, fullName: string): MailMessage {
  const link = `${appUrl()}/dashboard`;

  return {
    to,
    subject: 'Your faculty profile is approved',
    text: [
      `Your account has been approved, ${fullName}.`,
      '',
      'You can now publish your profile to the public directory:',
      link,
    ].join('\n'),
    html: layout(
      'Your account is approved',
      `<p style="margin:0 0 20px;font-size:15px;line-height:1.55;">
         Your account has been approved. You can now publish your profile to the public
         faculty directory.
       </p>
       ${button(link, 'Open your dashboard')}`,
    ),
  };
}

/**
 * Sent on rejection. `reason` is administrator-written text, inserted into the plain-text
 * body only — never interpolated into HTML, so it cannot carry markup.
 */
export function rejectionEmail(to: string, reason: string): MailMessage {
  return {
    to,
    subject: 'About your faculty portal registration',
    text: [
      'Your registration was not approved.',
      '',
      `Reason given: ${reason}`,
      '',
      'If you believe this is a mistake, contact your department administrator.',
    ].join('\n'),
  };
}
