import "server-only";
import nodemailer from "nodemailer";

/**
 * Email sender for account verification. Uses Gmail SMTP when SMTP_USER +
 * SMTP_PASS (a Google App Password) are configured. Until then, it falls back
 * to logging the verification link to the server console so the flow is fully
 * testable in development without real email delivery.
 */

const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || SMTP_USER || "no-reply@vexa.local";

/** Base URL used to build absolute verification links. */
export function baseUrl(): string {
  return (
    process.env.AUTH_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "http://localhost:3001"
  ).replace(/\/$/, "");
}

let transporter: nodemailer.Transporter | null = null;
function getTransporter(): nodemailer.Transporter | null {
  if (!SMTP_USER || !SMTP_PASS) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transporter;
}

/** Whether real email delivery is configured. */
export function mailerConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS);
}

/**
 * Send (or log, in dev) an account-verification email. Returns the absolute
 * verify URL so callers can surface it in dev when no SMTP is set.
 */
export async function sendVerificationEmail(input: {
  to: string;
  name: string;
  token: string;
  locale: string;
}): Promise<{ sent: boolean; url: string }> {
  const url = `${baseUrl()}/${input.locale}/verify?token=${encodeURIComponent(
    input.token,
  )}`;

  const tx = getTransporter();
  if (!tx) {
    // Dev fallback: no SMTP configured — log the link instead of sending.
    console.log(
      `\n[mailer] SMTP not configured. Verification link for ${input.to}:\n  ${url}\n`,
    );
    return { sent: false, url };
  }

  const subject = "Xác minh tài khoản Vexa / Verify your Vexa account";
  const html = `
    <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#111">Vexa</h2>
      <p>Chào ${escapeHtml(input.name)},</p>
      <p>Nhấn nút bên dưới để xác minh địa chỉ email và kích hoạt tài khoản của bạn.</p>
      <p>Click the button below to verify your email and activate your account.</p>
      <p style="margin:24px 0">
        <a href="${url}" style="background:#111;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">
          Xác minh email / Verify email
        </a>
      </p>
      <p style="color:#666;font-size:13px">Hoặc mở liên kết: <br><a href="${url}">${url}</a></p>
      <p style="color:#666;font-size:13px">Liên kết hết hạn sau 24 giờ. Nếu bạn không đăng ký, hãy bỏ qua email này.</p>
    </div>`;

  await tx.sendMail({ from: MAIL_FROM, to: input.to, subject, html });
  return { sent: true, url };
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
