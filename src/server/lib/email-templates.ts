type EmailContent = {
  subject: string;
  text: string;
  html: string;
};

type BrandedParams = {
  recipientName: string;
};

const BRAND_NAME = 'JustAVPS';
const ACCENT = '#f59e0b';
const FOREGROUND = '#0a0a0a';
const BACKGROUND = '#ffffff';
const MUTED = '#737373';
const BORDER = '#e5e5e5';

function renderShell(body: string): string {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:540px;margin:0 auto;padding:40px 24px;color:${FOREGROUND};line-height:1.6;background:${BACKGROUND};">
      <div style="padding-bottom:24px;border-bottom:1px solid ${BORDER};margin-bottom:32px;">
        <span style="font-size:14px;font-weight:600;letter-spacing:-0.01em;">${BRAND_NAME}</span>
      </div>
      ${body}
      <div style="margin-top:40px;padding-top:24px;border-top:1px solid ${BORDER};color:${MUTED};font-size:12px;">
        ${BRAND_NAME} &middot; Infrastructure for agents that never sleep.
      </div>
    </div>
  `;
}

function renderCtaButton(href: string, label: string): string {
  return `
    <p style="margin:0 0 28px;">
      <a href="${href}" style="display:inline-block;background:${FOREGROUND};color:${BACKGROUND};text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:500;font-size:14px;border:1px solid ${ACCENT}66;box-shadow:0 0 0 4px ${ACCENT}1a;">${label}</a>
    </p>
  `;
}

function renderLinkFallback(href: string): string {
  return `
    <p style="margin:0 0 8px;color:${MUTED};font-size:12px;">Or paste this link into your browser:</p>
    <p style="margin:0 0 24px;font-size:12px;word-break:break-all;"><a href="${href}" style="color:${FOREGROUND};">${href}</a></p>
  `;
}

export function renderVerificationEmail(params: BrandedParams & { verifyUrl: string }): EmailContent {
  const heading = 'Verify your email';
  const intro = 'Click the button below to confirm your email address and finish setting up your account.';
  const expiry = 'This link expires in 24 hours.';

  return {
    subject: `Verify your email for ${BRAND_NAME}`,
    text: [
      `Hi ${params.recipientName},`,
      '',
      intro,
      '',
      params.verifyUrl,
      '',
      expiry,
      '',
      BRAND_NAME,
    ].join('\n'),
    html: renderShell(`
      <h1 style="font-size:22px;font-weight:500;letter-spacing:-0.02em;margin:0 0 16px;">${heading}</h1>
      <p style="margin:0 0 24px;color:${MUTED};font-size:14px;">Hi ${params.recipientName}, ${intro.toLowerCase()}</p>
      ${renderCtaButton(params.verifyUrl, 'Verify email')}
      ${renderLinkFallback(params.verifyUrl)}
      <p style="margin:0;color:${MUTED};font-size:12px;">${expiry} If you did not create an account, you can safely ignore this email.</p>
    `),
  };
}

export function renderPasswordResetEmail(params: BrandedParams & { resetUrl: string }): EmailContent {
  const heading = 'Reset your password';
  const intro = 'We received a request to reset the password on your account. Click the button below to choose a new one.';
  const expiry = 'This link expires in 1 hour.';

  return {
    subject: `Reset your ${BRAND_NAME} password`,
    text: [
      `Hi ${params.recipientName},`,
      '',
      intro,
      '',
      params.resetUrl,
      '',
      expiry,
      '',
      'If you did not request a password reset, you can safely ignore this email.',
      '',
      BRAND_NAME,
    ].join('\n'),
    html: renderShell(`
      <h1 style="font-size:22px;font-weight:500;letter-spacing:-0.02em;margin:0 0 16px;">${heading}</h1>
      <p style="margin:0 0 24px;color:${MUTED};font-size:14px;">Hi ${params.recipientName}, ${intro.toLowerCase()}</p>
      ${renderCtaButton(params.resetUrl, 'Reset password')}
      ${renderLinkFallback(params.resetUrl)}
      <p style="margin:0;color:${MUTED};font-size:12px;">${expiry} If you did not request a password reset, you can safely ignore this email.</p>
    `),
  };
}
