import nodemailer from 'nodemailer';
import type { Env } from '../platform/env.js';
import type { Logger } from '../platform/logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  /** Có SMTP thật hay không (dev không cấu hình thì email chỉ được in ra log). */
  readonly configured: boolean;
  send(message: MailMessage): Promise<void>;
  /** Kiểm tra kết nối SMTP. */
  verify(): Promise<void>;
}

type SmtpEnv = Pick<
  Env,
  'NODE_ENV' | 'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_SECURE' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'SMTP_FROM'
>;

export function createMailer(env: SmtpEnv, logger: Logger): Mailer {
  if (!env.SMTP_HOST) {
    return {
      configured: false,
      async send(message) {
        if (env.NODE_ENV === 'production') throw new Error('SMTP chưa được cấu hình');
        // Dev: in ra log để vẫn lấy được link đặt lại mật khẩu, mật khẩu tạm…
        logger.info({ mail: message }, `[mail chưa gửi — chưa cấu hình SMTP] ${message.subject} → ${message.to}`);
      },
      async verify() {
        throw new Error('SMTP chưa được cấu hình (SMTP_HOST)');
      },
    };
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });

  return {
    configured: true,
    async send(message) {
      await transport.sendMail({ from: env.SMTP_FROM, ...message });
    },
    async verify() {
      await transport.verify();
    },
  };
}

/** Mailer dùng trong test: lưu email vào mảng. */
export function createMemoryMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    configured: true,
    sent,
    async send(message) {
      sent.push(message);
    },
    async verify() {},
  };
}
