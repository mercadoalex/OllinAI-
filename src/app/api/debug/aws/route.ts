/**
 * Debug endpoint — verifies AWS credentials are working.
 * Returns connection status without exposing secret values.
 * DELETE THIS FILE before going to production.
 */

import { NextResponse } from "next/server";
import { ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { getBaseClient } from "@/lib/dynamo/client";

export async function GET() {
  const region = process.env.AWS_REGION || "(not set)";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const hasSecret = !!process.env.AWS_SECRET_ACCESS_KEY;

  const info: Record<string, unknown> = {
    region,
    accessKeyIdPrefix: accessKeyId ? accessKeyId.substring(0, 8) + "..." : "(not set)",
    hasSecretKey: hasSecret,
    secretKeyLength: process.env.AWS_SECRET_ACCESS_KEY?.length || 0,
  };

  try {
    const client = getBaseClient();
    const result = await client.send(new ListTablesCommand({ Limit: 5 }));
    info.connectionStatus = "SUCCESS";
    info.tables = result.TableNames;
  } catch (error: any) {
    info.connectionStatus = "FAILED";
    info.errorName = error.name;
    info.errorMessage = error.message?.substring(0, 200);
  }

  return NextResponse.json(info);
}
