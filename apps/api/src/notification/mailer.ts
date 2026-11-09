import { Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../config/env';

export const MAILER = Symbol('MAILER');

export interface OutgoingEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/** Sends one email or throws. Kept tiny so tests can swap in a fake. */
export interface Mailer {
  readonly enabled: boolean;
  /** Sender address shown in the admin ("Bovann OCD Live <…>"). */
  readonly from: string | null;
  send(email: OutgoingEmail): Promise<void>;
}

/**
 * SMTP sender: works with Gmail (smtp.gmail.com, an App Password), Brevo
 * (smtp-relay.brevo.com) or Mailpit in development. Switching provider is a
 * configuration change only.
 */
export class SmtpMailer implements Mailer {
  readonly enabled = true;
  private readonly transporter: Transporter;
  private readonly logger = new Logger(SmtpMailer.name);

  constructor(private readonly env: Env) {
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: !env.SMTP_SECURE && env.SMTP_PORT === 587,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  get from(): string {
    return this.env.EMAIL_FROM!;
  }

  async send(email: OutgoingEmail): Promise<void> {
    await this.transporter.sendMail({
      from: this.env.EMAIL_FROM,
      replyTo: this.env.EMAIL_REPLY_TO,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
    });
  }

  /** Logs (does not throw) whether the SMTP server accepts our settings. */
  async checkConnection(): Promise<void> {
    try {
      await this.transporter.verify();
      this.logger.log(`SMTP ready (${this.env.SMTP_HOST}:${this.env.SMTP_PORT})`);
    } catch (error) {
      this.logger.warn(`SMTP check failed: ${describeSendError(error)}`);
    }
  }
}

export class DisabledMailer implements Mailer {
  readonly enabled = false;
  readonly from = null;
  send(): Promise<void> {
    return Promise.reject(new Error('Email sending is disabled (EMAIL_TRANSPORT=disabled)'));
  }
}

interface SmtpError {
  code?: string;
  responseCode?: number;
  response?: string;
  message?: string;
}

/** Short, safe description of a sending error (no credentials are ever part of it). */
export function describeSendError(error: unknown): string {
  const e = error as SmtpError;
  const text = e.response ?? e.message ?? String(error);
  return [e.code, e.responseCode, text].filter(Boolean).join(' ').slice(0, 900);
}

/**
 * A rejection that retrying won't fix: the address doesn't exist or the
 * message is refused for good (SMTP 550/551/553, bad envelope). Quota and
 * temporary refusals (4xx, 5.4.x) are retried.
 */
export function isPermanentSendError(error: unknown): boolean {
  const e = error as SmtpError;
  if (e.code === 'EENVELOPE') return true;
  if (!e.responseCode || ![550, 551, 553].includes(e.responseCode)) return false;
  return !/5\.4\.\d|quota|rate|limit|try again/i.test(e.response ?? '');
}
