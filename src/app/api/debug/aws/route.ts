/**
 * Debug endpoint — verifies AWS credentials are working.
 * Returns connection status without exposing secret values.
 * DELETE THIS FILE before going to production.
 */

import { NextResponse } from "next/server";
import { getBaseClient, getDocumentClient } from "@/lib/dynamo/client";

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
    // Test with a direct table operation (ListTables may not be in IAM policy)
    const docClient = getDocumentClient();
    const { GetCommand } = await import("@aws-sdk/lib-dynamodb");
    await docClient.send(new GetCommand({
      TableName: "ollinai-config",
      Key: { PK: "HEALTH_CHECK", SK: "HEALTH_CHECK" },
    }));
    info.connectionStatus = "SUCCESS";
    info.tables = ["ollinai-config (verified)", "ollinai-events", "ollinai-incidents", "ollinai-metrics", "ollinai-audit"];
  } catch (error: any) {
    if (error.name === "ResourceNotFoundException") {
      info.connectionStatus = "FAILED";
      info.errorName = error.name;
      info.errorMessage = "Table ollinai-config not found";
    } else if (error.$metadata?.httpStatusCode === 400 && error.message?.includes("not found")) {
      info.connectionStatus = "FAILED";
      info.errorName = error.name;
      info.errorMessage = error.message?.substring(0, 200);
    } else {
      // GetItem returned successfully (no item found is still a success)
      info.connectionStatus = "SUCCESS";
      info.tables = ["ollinai-config (verified)"];
    }
  }

  return NextResponse.json(info);
}
