import { NextResponse } from "next/server";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";

export async function GET() {
  const tenantId = process.env.DEFAULT_TENANT_ID || "not-set";
  const region = process.env.AWS_REGION || "not-set";
  const hasKey = !!process.env.AWS_ACCESS_KEY_ID;
  const hasSecret = !!process.env.AWS_SECRET_ACCESS_KEY;
  const keyPrefix = process.env.AWS_ACCESS_KEY_ID?.slice(0, 8) || "none";

  try {
    const client = getDocumentClient();
    const result = await client.send(new QueryCommand({
      TableName: TableNames.EVENTS,
      IndexName: "GSI2-TeamView",
      KeyConditionExpression: "GSI2PK = :pk",
      ExpressionAttributeValues: { ":pk": `TENANT#${tenantId}#TEAM#UNASSIGNED` },
      Select: "COUNT",
    }));

    return NextResponse.json({
      status: "ok",
      tenantId,
      region,
      keyPrefix,
      hasKey,
      hasSecret,
      eventsCount: result.Count,
    });
  } catch (err: any) {
    return NextResponse.json({
      status: "error",
      tenantId,
      region,
      keyPrefix,
      hasKey,
      hasSecret,
      error: err.message?.slice(0, 200),
    });
  }
}
