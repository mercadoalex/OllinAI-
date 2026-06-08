import { NextRequest, NextResponse } from "next/server";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";

export async function GET(request: NextRequest) {
  const tenantId = process.env.DEFAULT_TENANT_ID || "(not set)";
  
  const info: Record<string, unknown> = {
    DEFAULT_TENANT_ID: tenantId,
  };

  if (tenantId && tenantId !== "(not set)") {
    try {
      const client = getDocumentClient();
      const pk = `TENANT#${tenantId}#SCOPE#ALL#ALL`;
      
      const result = await client.send(new QueryCommand({
        TableName: TableNames.METRICS,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :skPrefix)",
        ExpressionAttributeValues: {
          ":pk": pk,
          ":skPrefix": "PERIOD#",
        },
        ScanIndexForward: false,
        Limit: 1,
      }));

      info.metricsQuery = {
        pk,
        itemCount: result.Items?.length || 0,
        firstItem: result.Items?.[0] ? {
          SK: result.Items[0].SK,
          deploymentFrequency: result.Items[0].deploymentFrequency,
          dataPoints: result.Items[0].dataPoints,
        } : null,
      };

      // Also check events
      const events = await client.send(new QueryCommand({
        TableName: TableNames.EVENTS,
        IndexName: "GSI2-TeamView",
        KeyConditionExpression: "GSI2PK = :pk",
        ExpressionAttributeValues: {
          ":pk": `TENANT#${tenantId}#TEAM#UNASSIGNED`,
        },
        Select: "COUNT",
      }));
      info.eventsCount = events.Count;
    } catch (err: any) {
      info.error = err.message;
    }
  }

  return NextResponse.json(info);
}
