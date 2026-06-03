/**
 * Health Check Endpoint
 * GET /api/health (also available at /health via rewrite)
 */
import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    status: "healthy",
    service: "ollinai",
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) || "local",
    timestamp: new Date().toISOString(),
  });
}
