import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/**
 * Sends a verification code to the recipient's email address.
 * In development or when RESEND_API_KEY is unset, prints to server console.
 */
export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  console.log(`\n========================================`);
  console.log(`[EMAIL DISPATCH] Verification code for ${email}: ${code}`);
  console.log(`========================================\n`);

  if (!resend || !process.env.RESEND_API_KEY) {
    return;
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Auth Workflow <onboarding@resend.dev>",
      to: email,
      subject: "Your Verification Code",
      text: `Your verification code is: ${code}. It expires in 10 minutes.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; rounded: 8px;">
          <h2 style="color: #18181b; margin-bottom: 16px;">Verify your email</h2>
          <p style="color: #52525b; margin-bottom: 24px;">Please enter the 6-digit code below to complete your registration:</p>
          <div style="background-color: #f4f4f5; padding: 16px; border-radius: 6px; text-align: center; font-size: 28px; font-weight: bold; letter-spacing: 6px; color: #18181b;">
            ${code}
          </div>
          <p style="color: #71717a; font-size: 13px; margin-top: 24px;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Failed to send verification email via Resend:", error);
    // Don't crash the auth flow if external email provider has an outage
  }
}

/**
 * Sends a password reset link to the recipient's email address.
 * In development or when RESEND_API_KEY is unset, prints to server console.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  console.log(`\n========================================`);
  console.log(`[EMAIL DISPATCH] Password reset link for ${email}:`);
  console.log(`  ${resetUrl}`);
  console.log(`========================================\n`);

  if (!resend || !process.env.RESEND_API_KEY) {
    return;
  }

  try {
    await resend.emails.send({
      from: process.env.EMAIL_FROM || "Auth Workflow <onboarding@resend.dev>",
      to: email,
      subject: "Reset Your Password",
      text: `Click this link to reset your password: ${resetUrl}\n\nThis link expires in 15 minutes and can only be used once.`,
      html: `
        <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; border: 1px solid #e4e4e7; border-radius: 8px;">
          <h2 style="color: #18181b; margin-bottom: 16px;">Reset your password</h2>
          <p style="color: #52525b; margin-bottom: 24px;">Click the button below to reset your password. This link expires in 15 minutes and can only be used once.</p>
          <a href="${resetUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: 600; font-size: 14px;">Reset Password</a>
          <p style="color: #71717a; font-size: 13px; margin-top: 24px;">If you did not request a password reset, you can safely ignore this email. Your password will not be changed.</p>
          <p style="color: #a1a1aa; font-size: 11px; margin-top: 8px; word-break: break-all;">Or copy this link: ${resetUrl}</p>
        </div>
      `,
    });
  } catch (error) {
    console.error("Failed to send password reset email via Resend:", error);
  }
}
