import "server-only";

import { Resend } from "resend";

// Transactional email through Resend (decided 2026-09-15): invites, password resets and 2FA
// reset notices (FR-201, FR-208). Without RESEND_API_KEY, development and tests keep messages in
// an in-memory outbox and development prints them to the server log. Production refuses to run
// without a key rather than silently dropping a password reset.

type Env = Readonly<Record<string, string | undefined>>;

export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
}>;

/** Messages not sent through Resend (development and tests only). */
export const outbox: EmailMessage[] = [];

export async function sendEmail(
  message: EmailMessage,
  env: Env = process.env,
): Promise<void> {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;

  if (apiKey && from) {
    const { error } = await new Resend(apiKey).emails.send({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
    // The provider's error names the failure without echoing the message or the address.
    if (error) throw new Error(`Email delivery failed: ${error.name}`);
    return;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY and EMAIL_FROM must be set in production.");
  }
  outbox.push(message);
  if (env.NODE_ENV === "development") {
    console.info(
      `[email] to ${message.to}: ${message.subject}\n${message.text}`,
    );
  }
}
