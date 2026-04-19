import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { config } from "../config.js";

let _transport: Transporter | null = null;

function transport(): Transporter | null {
  if (_transport) return _transport;
  if (!config.SMTP_HOST || !config.SMTP_PORT) return null;
  _transport = nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: config.SMTP_PORT,
    secure: config.SMTP_PORT === 465,
    auth: config.SMTP_USER && config.SMTP_PASS ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
  });
  return _transport;
}

export interface SendArgs {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendMail(args: SendArgs): Promise<{ messageId?: string; skipped?: boolean }> {
  const t = transport();
  if (!t) return { skipped: true };
  const info = await t.sendMail({
    from: config.MAIL_FROM ?? "Flyer <no-reply@localhost>",
    to: args.to,
    subject: args.subject,
    text: args.text,
    html: args.html,
  });
  return { messageId: info.messageId };
}

export async function sendMagicLink(args: { to: string; url: string; name?: string }): Promise<{ messageId?: string; skipped?: boolean }> {
  const who = args.name ? `, ${args.name}` : "";
  return sendMail({
    to: args.to,
    subject: "Your flyer admin sign-in link",
    text: `Hello${who},\n\nClick to sign in (valid 15 minutes):\n${args.url}\n\nIf you did not request this, ignore this email.`,
  });
}
