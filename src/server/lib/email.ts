import { MailtrapClient } from 'mailtrap';
import { config } from './config';

let client: MailtrapClient | null = null;

function getClient() {
  if (!config.isMailtrapConfigured()) {
    return null;
  }

  if (!client) {
    client = new MailtrapClient({
      token: config.MAILTRAP_API_TOKEN,
      sandbox: config.MAILTRAP_USE_SANDBOX,
      testInboxId: config.MAILTRAP_USE_SANDBOX && config.MAILTRAP_INBOX_ID > 0
        ? config.MAILTRAP_INBOX_ID
        : undefined,
    });
  }

  return client;
}

export const emailClient = {
  isConfigured(): boolean {
    return !!getClient();
  },

  async sendCheckoutAccessEmail(params: {
    email: string;
    name?: string | null;
    sessionId: string;
    planLabel: string;
  }): Promise<boolean> {
    const mailer = getClient();
    if (!mailer) {
      console.warn('[EMAIL] Mailtrap not configured - skipping checkout access email');
      return false;
    }

    const recipientName = params.name?.trim() || params.email.split('@')[0] || 'there';
    const accessUrl = `${config.APP_URL}/checkout/success?session_id=${encodeURIComponent(params.sessionId)}`;

    try {
      await mailer.send({
        from: {
          email: config.MAILTRAP_SENDER_EMAIL,
          name: config.MAILTRAP_SENDER_NAME,
        },
        to: [{ email: params.email, name: recipientName }],
        subject: `Your JustAVPS ${params.planLabel} is ready to unlock`,
        category: 'checkout-access',
        text: [
          `Hi ${recipientName},`,
          '',
          `Your checkout for ${params.planLabel} is complete.`,
          'Open your dashboard from this secure link:',
          accessUrl,
          '',
          'We will create your account and sign you in automatically from there.',
          '',
          'JustAVPS',
        ].join('\n'),
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:32px 24px;color:#111827;line-height:1.6;">
            <p style="margin:0 0 16px;">Hi ${recipientName},</p>
            <p style="margin:0 0 16px;">Your checkout for <strong>${params.planLabel}</strong> is complete.</p>
            <p style="margin:0 0 24px;">Use this secure link to unlock your dashboard and machine access:</p>
            <p style="margin:0 0 28px;">
              <a href="${accessUrl}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:10px;font-weight:600;">Open your dashboard</a>
            </p>
            <p style="margin:0;color:#6b7280;font-size:14px;">We will create your account and sign you in automatically from there.</p>
          </div>
        `,
      });

      console.log(`[EMAIL] Sent checkout access email to ${params.email}`);
      return true;
    } catch (error) {
      console.error(`[EMAIL] Failed to send checkout access email to ${params.email}:`, error);
      return false;
    }
  },
};
