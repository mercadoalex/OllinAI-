/**
 * Next.js Middleware — Route Protection & Onboarding Routing
 *
 * Redirects unauthenticated users to /sign-in for protected routes.
 * Public routes (sign-in, sign-up, forgot-password, api/auth, health) are allowed through.
 *
 * After authentication, enforces onboarding routing:
 * - Users with incomplete onboarding are redirected from /dashboard/* to /onboarding/{step}
 * - Users with complete onboarding are redirected from /onboarding/* to /dashboard
 *
 * Requirements: 1.3, 1.4
 */

import { getToken } from "next-auth/jwt";
import { NextRequest, NextResponse } from "next/server";

// ─── Step-to-URL mapping ───────────────────────────────────────────────────────

/** Maps onboarding step names to their URL paths */
const STEP_TO_URL: Record<string, string> = {
  integration_created: "/onboarding/integration",
  pipeline_configured: "/onboarding/pipeline",
  first_event_received: "/onboarding/event",
};

// ─── Route Configuration ───────────────────────────────────────────────────────

// Routes that don't require authentication
const publicPaths = [
  "/sign-in",
  "/sign-up",
  "/forgot-password",
  "/api/auth",
  "/api/health",
  "/api/webhooks",
  "/api/collector",
  "/api/debug",
  "/api/onboarding",
  "/health",
  "/_next",
  "/favicon.ico",
];

// Routes that need auth but are exempt from onboarding redirect checks
const onboardingExemptPaths = [
  "/onboarding",
  "/api/onboarding",
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

  // ─── Onboarding routing logic ──────────────────────────────────────────────

  try {
    const onboardingComplete = token.onboardingComplete as boolean | undefined;

    // If onboarding is NOT complete and user is trying to access dashboard
    if (
      (onboardingComplete === false || onboardingComplete === undefined) &&
      pathname.startsWith("/dashboard")
    ) {
      // Redirect to the first onboarding step (integration is step 1)
      const redirectUrl = new URL(
        STEP_TO_URL["integration_created"],
        request.url
      );
      return NextResponse.redirect(redirectUrl);
    }

    // If onboarding IS complete and user is trying to access onboarding pages
    if (onboardingComplete === true && pathname.startsWith("/onboarding")) {
      const redirectUrl = new URL("/dashboard", request.url);
      return NextResponse.redirect(redirectUrl);
    }
  } catch (error) {
    // Fail-open: if anything goes wrong during onboarding check, allow access
    console.warn(
      "[middleware] Onboarding routing check failed, allowing access:",
      error instanceof Error ? error.message : String(error)
    );
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
