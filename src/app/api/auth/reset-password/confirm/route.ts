/**
 * Password Reset Confirmation Endpoint
 *
 * POST /api/auth/reset-password/confirm
 *
 * Validates the reset token and sets the new password.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resetPassword, validateResetToken } from "@/lib/auth/users";
import { validatePasswordStrength } from "@/lib/auth/passwords";

const ConfirmResetSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
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

  const validation = ConfirmResetSchema.safeParse(body);
  if (!validation.success) {
    return NextResponse.json(
      {
        error: "Validation failed",
        fields: validation.error.issues.map((i) => ({
          field: i.path.join("."),
          message: i.message,
        })),
      },
      { status: 400 }
    );
  }

  const { token, password } = validation.data;

  // Validate password strength
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return NextResponse.json(
      { error: "Weak password", fields: strength.errors.map((e) => ({ field: "password", message: e })) },
      { status: 400 }
    );
  }

  // Validate token
  const tokenResult = await validateResetToken(token);
  if (!tokenResult.valid) {
    return NextResponse.json(
      { error: "Invalid or expired reset token. Please request a new password reset." },
      { status: 400 }
    );
  }

  // Reset password
  try {
    const success = await resetPassword(token, password);
    if (!success) {
      return NextResponse.json(
        { error: "Failed to reset password. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      message: "Password reset successfully. You can now sign in with your new password.",
    });
  } catch (error) {
    console.error("Password reset confirm error:", error);
    return NextResponse.json(
      { error: "Failed to reset password. Please try again." },
      { status: 500 }
    );
  }
}
