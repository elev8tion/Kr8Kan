import nodemailer from "nodemailer";

import { createLogger } from "@kr8kan/logger";

import type { EmailTemplate } from "./templates";
import { renderTemplate } from "./templates";

export type { EmailTemplate };
export { renderTemplate };

const logger = createLogger("email");

/**
 * True when SMTP_HOST is set and email hasn't been explicitly disabled.
 * Exported so callers (e.g. the settings "test send" endpoint) can detect
 * the unconfigured case up front instead of relying on sendEmail's silent
 * log-and-return fallback.
 */
export function smtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST) &&
    process.env.NEXT_PUBLIC_DISABLE_EMAIL !== "true";
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
}

/**
 * Send a Kr8Kan email over SMTP. Without SMTP configured this logs the
 * rendered content instead (magic links stay usable from the server log —
 * handy for a fresh self-host before mail is set up).
 */
export async function sendEmail(
  to: string,
  template: EmailTemplate,
): Promise<void> {
  const { subject, html, text } = renderTemplate(template);
  if (!smtpConfigured()) {
    logger.info(
      { to, subject, type: template.type, text },
      "SMTP not configured — email logged instead of sent",
    );
    return;
  }
  await createTransport().sendMail({
    from: process.env.EMAIL_FROM ?? "Kr8Kan <kr8kan@localhost>",
    to,
    subject,
    html,
    text,
  });
  logger.info({ to, subject, type: template.type }, "email sent");
}
