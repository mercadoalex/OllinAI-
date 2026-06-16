/**
 * User Registration Endpoint
 *
 * POST /api/auth/register
 *
 * Creates a new user account. If no tenantId is provided,
 * creates a new tenant with the user as tenant_admin.
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createUser, emailExists } from "@/lib/auth/users";
import { validatePasswordStrength } from "@/lib/auth/passwords";
import { seedTenantDemoData } from "@/lib/demo/seed-tenant";

const RegisterSchema = z.object({
  email: z.string().email("Invalid email address"),
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  password: z.string().min(8, "Password must be at least 8 characters"),
  tenantName: z.string().min(2).max(100).optional(),
  tenantId: z.string().uuid().optional(),
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

  // Validate input
  const validation = RegisterSchema.safeParse(body);
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

  const { email, name, password, tenantName, tenantId } = validation.data;

  // Validate password strength
  const strength = validatePasswordStrength(password);
  if (!strength.valid) {
    return NextResponse.json(
      { error: "Weak password", fields: strength.errors.map((e) => ({ field: "password", message: e })) },
      { status: 400 }
    );
  }

  // Check if email already registered
  try {
    const exists = await emailExists(email);
    if (exists) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }
  } catch (error: any) {
    console.error("Registration error (email check):", error);
    return NextResponse.json(
      { error: "Service temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  try {
    const user = await createUser({ email, name, password, tenantName, tenantId });

    // Seed demo data for new tenants (non-blocking — never fail registration)
    if (!tenantId) {
      try {
        seedTenantDemoData(user.tenantId).catch((err) =>
          console.error("Demo seed failed (non-blocking):", err)
        );
      } catch (err) {
        console.error("Demo seed initiation failed (non-blocking):", err);
      }
    }

    return NextResponse.json(
      {
        message: "Account created successfully",
        userId: user.userId,
        tenantId: user.tenantId,
        role: user.role,
      },
      { status: 201 }
    );
  } catch (error: any) {
    // Handle DynamoDB condition check failures (race condition on email)
    if (error.name === "ConditionalCheckFailedException") {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Registration failed. Please try again." },
      { status: 500 }
    );
  }
}
