/**
 * Banner Dismiss API — POST /api/onboarding/banner/dismiss
 *
 * Permanently dismisses the onboarding resume banner for the tenant.
 * After dismissal, the banner no longer appears on the dashboard.
 *
 * Requirements: 7.3
 */

import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth/session";
import { dismissBanner } from "@/lib/onboarding/state";

export async function POST(request: NextRequest) {
  try {
    const authResult = await getAuthSession(request);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { tenantId } = authResult;

    await dismissBanner(tenantId);

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    console.error("[onboarding/banner/dismiss] Error:", error);
    return NextResponse.json(
      { error: "Failed to dismiss banner" },
      { status: 500 }
    );
  }
}
