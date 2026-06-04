/**
 * Password Reset Request Endpoint
 *
 * POST /api/auth/reset-password
 *
 * Generates a time-limited reset token and (in production) sends an email.
 * Always returns 200 to avoid revealing whether an email exists.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createResetToken } from "@/lib/auth/users";

const ResetRequestSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const validation = ResetRequestSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      { error: "Invalid email address" },
      { status: 400 }
    );
  }

  const { email } = validation.data;

  try {
    const token = await createResetToken(email);

    if (token) {
      // TODO: Send email via SES/Resend/SendGrid
      // For now, log the reset link (remove in production)
      const resetUrl = `${process.env.NEXTAUTH_URL || "http://localhost:3000"}/forgot-password?token=${token}`;
      console.log(`[Password Reset] Token generated for ${email}: ${resetUrl}`);
    }

    // Always return success to avoid email enumeration
    return NextResponse.json({
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  } catch (error) {
    console.error("Password reset error:", error);
    // Still return success to avoid leaking information
    return NextResponse.json({
      message: "If an account with that email exists, a password reset link has been sent.",
    });
  }
}
