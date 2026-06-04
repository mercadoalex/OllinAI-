/**
 * Next.js Middleware — Route Protection
 *
 * Redirects unauthenticated users to /sign-in for protected routes.
 * Public routes (sign-in, sign-up, forgot-password, api/auth, health) are allowed through.
 */

import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// Routes that don't require authentication
const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/api/auth",
  "/api/health",
  "/api/webhooks",
  "/api/collector",
  "/health",
  "/_next",
  "/favicon.ico",
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (publicPaths.some((path) => pathname.startsWith(path))) {
    return NextResponse.next();
  }

  // Allow static assets
  if (pathname.includes(".") && !pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  // Check for valid JWT token
  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token) {
    // Redirect to sign-in with callback URL
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(signInUrl);
  }

  // Add tenant ID to request headers for downstream server components
  const response = NextResponse.next();
  response.headers.set("x-tenant-id", (token.tenantId as string) || "");
  response.headers.set("x-user-id", (token.userId as string) || "");
  response.headers.set("x-user-role", (token.role as string) || "");

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
