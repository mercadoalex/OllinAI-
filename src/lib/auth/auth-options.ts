/**
 * NextAuth.js Configuration — OllinAI Platform
 *
 * JWT-based authentication with 1-hour token validity.
 * Embeds tenantId, userId, role, and teamIds in the JWT payload.
 *
 * Requirements: 7.4 (JWT with 1h validity), 7.5 (401 on missing/expired/malformed tokens)
 */

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
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

        // TODO: Replace with actual user lookup from DynamoDB
        // For now, this is a placeholder that validates credentials
        // against the ollinai-config table (SK: USER#{userId})
        // In production, this would verify the password hash and
        // return the user record with tenantId, role, and teamIds.
        return null;
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
    async jwt({ token, user }) {
      // On initial sign-in, embed custom claims from the user record
      if (user) {
        token.tenantId = (user as any).tenantId;
        token.userId = (user as any).userId;
        token.role = (user as any).role;
        token.teamIds = (user as any).teamIds ?? [];
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
      }
      return session;
    },
  },

  pages: {
    signIn: "/auth/signin",
    error: "/auth/error",
  },
};
