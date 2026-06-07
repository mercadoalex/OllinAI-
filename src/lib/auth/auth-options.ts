/**
 * NextAuth.js Configuration — OllinAI Platform
 *
 * JWT-based authentication with 1-hour token validity.
 * Embeds tenantId, userId, role, teamIds, and onboardingComplete in the JWT payload.
 *
 * Requirements: 7.4 (JWT with 1h validity), 7.5 (401 on missing/expired/malformed tokens)
 * Requirements: 1.3, 1.4 (onboarding state in session)
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { findUserByEmail } from "@/lib/auth/users";
import { verifyPassword } from "@/lib/auth/passwords";
import { getOnboardingState } from "@/lib/onboarding/state";
import type { UserRole } from "@/lib/types/auth";

/** JWT token max age in seconds (1 hour) */
const JWT_MAX_AGE = 3600;

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Look up user by email in DynamoDB
        const user = await findUserByEmail(credentials.email);
        if (!user) {
          return null;
        }

        // Verify password against bcrypt hash
        const valid = await verifyPassword(credentials.password, user.passwordHash);
        if (!valid) {
          return null;
        }

        // Return user object — NextAuth passes this to the jwt callback
        return {
          id: user.userId,
          email: user.email,
          name: user.name,
          tenantId: user.tenantId,
          userId: user.userId,
          role: user.role,
          teamIds: user.teamIds,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    maxAge: JWT_MAX_AGE,
  },

  jwt: {
    maxAge: JWT_MAX_AGE,
  },

  callbacks: {
    async jwt({ token, user, trigger }) {
      // On initial sign-in, embed custom claims from the user record
      if (user) {
        token.tenantId = (user as any).tenantId;
        token.userId = (user as any).userId;
        token.role = (user as any).role;
        token.teamIds = (user as any).teamIds ?? [];

        // Check onboarding state for the tenant (fail-open: default to true)
        token.onboardingComplete = await resolveOnboardingComplete(
          (user as any).tenantId
        );
      }

      // Allow session updates to refresh the onboarding state
      if (trigger === "update" && token.tenantId) {
        token.onboardingComplete = await resolveOnboardingComplete(
          token.tenantId as string
        );
      }

      return token;
    },

    async session({ session, token }) {
      // Expose custom claims on the session object
      if (session.user) {
        (session as any).tenantId = token.tenantId as string;
        (session as any).userId = token.userId as string;
        (session as any).role = token.role as UserRole;
        (session as any).teamIds = token.teamIds as string[];
        (session as any).onboardingComplete =
          token.onboardingComplete as boolean;
      }
      return session;
    },
  },

  pages: {
    signIn: "/sign-in",
    error: "/sign-in",
  },
};

/**
 * Resolves the onboardingComplete flag for a tenant.
 *
 * Logic:
 * - If state is null (existing tenant without onboarding record) → true (don't block them)
 * - If status is 'completed' → true
 * - If status is 'skipped' → true
 * - If status is 'in_progress' → false
 * - On error (DynamoDB unavailable) → true (fail-open)
 *
 * Requirements: 1.3, 1.4
 */
async function resolveOnboardingComplete(tenantId: string): Promise<boolean> {
  try {
    const state = await getOnboardingState(tenantId);

    // No record exists — existing tenant, don't block them
    if (state === null) {
      return true;
    }

    // Completed or skipped — allow dashboard access
    if (state.status === "completed" || state.status === "skipped") {
      return true;
    }

    // In progress — onboarding not yet complete
    return false;
  } catch (error) {
    // Fail-open: if DynamoDB is unavailable, allow access
    console.warn(
      "[auth] Failed to check onboarding state, defaulting to complete (fail-open):",
      error instanceof Error ? error.message : String(error)
    );
    return true;
  }
}
