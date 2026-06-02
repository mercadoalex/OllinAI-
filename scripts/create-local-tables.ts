/**
 * Create DynamoDB Local tables for development and testing.
 *
 * Usage:
 *   npx tsx scripts/create-local-tables.ts
 *
 * Prerequisites:
 *   - DynamoDB Local running on http://localhost:8000
 *     (e.g. via `docker run -p 8000:8000 amazon/dynamodb-local`)
 *
 * Environment variables:
 *   - DYNAMODB_ENDPOINT: Override the DynamoDB Local endpoint (default: http://localhost:8000)
 */

import {
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
  ListTablesCommand,
  ResourceInUseException,
} from "@aws-sdk/client-dynamodb";
import { allTables, TableDefinition } from "../infra/dynamodb-tables";

const ENDPOINT = process.env.DYNAMODB_ENDPOINT || "http://localhost:8000";

const client = new DynamoDBClient({
  endpoint: ENDPOINT,
  region: "us-east-1",
  credentials: {
    accessKeyId: "local",
    secretAccessKey: "local",
  },
});

async function deleteTableIfExists(tableName: string): Promise<void> {
  try {
    await client.send(new DeleteTableCommand({ TableName: tableName }));
    console.log(`  Deleted existing table: ${tableName}`);
  } catch (error: unknown) {
    // Table doesn't exist — that's fine
    if (
      error instanceof Error &&
      error.name === "ResourceNotFoundException"
    ) {
      return;
    }
    throw error;
  }
}

async function createTable(definition: TableDefinition): Promise<void> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: definition.TableName,
        KeySchema: definition.KeySchema,
        AttributeDefinitions: definition.AttributeDefinitions,
        GlobalSecondaryIndexes: definition.GlobalSecondaryIndexes,
        BillingMode: definition.BillingMode,
      })
    );
    console.log(`  Created table: ${definition.TableName}`);
  } catch (error: unknown) {
    if (error instanceof ResourceInUseException) {
      console.log(`  Table already exists: ${definition.TableName}`);
      return;
    }
    throw error;
  }
}

async function listExistingTables(): Promise<string[]> {
  const response = await client.send(new ListTablesCommand({}));
  return response.TableNames || [];
}

async function main(): Promise<void> {
  const forceRecreate = process.argv.includes("--force");

  console.log(`\nOllinAI DynamoDB Local Setup`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Mode: ${forceRecreate ? "Force recreate" : "Create if missing"}\n`);

  // Verify connectivity
  try {
    const existing = await listExistingTables();
    console.log(`Connected. Existing tables: ${existing.length > 0 ? existing.join(", ") : "(none)"}\n`);
  } catch (error: unknown) {
    console.error(
      `\nFailed to connect to DynamoDB Local at ${ENDPOINT}.`
    );
    console.error(
      "Make sure DynamoDB Local is running:\n  docker run -p 8000:8000 amazon/dynamodb-local\n"
    );
    process.exit(1);
  }

  console.log(`Creating ${allTables.length} tables...\n`);

  for (const table of allTables) {
    if (forceRecreate) {
      await deleteTableIfExists(table.TableName);
    }
    await createTable(table);
  }

  // Verify final state
  const finalTables = await listExistingTables();
  console.log(`\nDone. Tables available: ${finalTables.join(", ")}\n`);
}

main().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});
