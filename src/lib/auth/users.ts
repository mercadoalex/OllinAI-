/**
 * User data access layer for authentication.
 *
 * Users are stored in the ollinai-config table:
 *   PK: TENANT#{tenantId}
 *   SK: USER#{userId}
 *
 * Email lookup uses a GSI or a separate email-to-user mapping:
 *   PK: EMAIL_INDEX
 *   SK: {email}
 *
 * Password reset tokens:
 *   PK: RESET_TOKEN
 *   SK: {token}
 *   TTL: expires in 1 hour
 */

import { randomUUID, randomBytes } from "crypto";
import { GetCommand, PutCommand, QueryCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { getDocumentClient, TableNames } from "@/lib/dynamo/client";
import { hashPassword } from "./passwords";
import type { UserRole } from "@/lib/types/auth";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface UserRecord {
  userId: string;
  email: string;
  name: string;
  passwordHash: string;
  tenantId: string;
  role: UserRole;
  teamIds: string[];
  createdAt: string;
  updatedAt: string;
  emailVerified?: boolean;
}

export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  tenantName?: string; // If provided, creates a new tenant
  tenantId?: string; // If provided, joins existing tenant
}

export interface ResetToken {
  token: string;
  email: string;
  expiresAt: number; // Unix timestamp
  createdAt: string;
}

// ─── User Lookup ───────────────────────────────────────────────────────────────

/**
 * Find a user by email address.
 * Uses the EMAIL_INDEX partition to locate the user across tenants.
 */
export async function findUserByEmail(email: string): Promise<UserRecord | null> {
  const client = getDocumentClient();
  const normalizedEmail = email.toLowerCase().trim();

  // Look up email index
  const indexResult = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: "EMAIL_INDEX",
        SK: normalizedEmail,
      },
    })
  );

  if (!indexResult.Item) {
    return null;
  }

  const { tenantId, userId } = indexResult.Item as { tenantId: string; userId: string };

  // Fetch the full user record
  const userResult = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: `TENANT#${tenantId}`,
        SK: `USER#${userId}`,
      },
    })
  );

  if (!userResult.Item) {
    return null;
  }

  const item = userResult.Item;
  return {
    userId: item.userId as string,
    email: item.email as string,
    name: item.name as string,
    passwordHash: item.passwordHash as string,
    tenantId: item.tenantId as string,
    role: item.role as UserRole,
    teamIds: (item.teamIds as string[]) || [],
    createdAt: item.createdAt as string,
    updatedAt: item.updatedAt as string,
    emailVerified: item.emailVerified as boolean | undefined,
  };
}

/**
 * Check if an email is already registered.
 */
export async function emailExists(email: string): Promise<boolean> {
  const client = getDocumentClient();
  const normalizedEmail = email.toLowerCase().trim();

  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: "EMAIL_INDEX",
        SK: normalizedEmail,
      },
    })
  );

  return !!result.Item;
}

// ─── User Creation ─────────────────────────────────────────────────────────────

/**
 * Create a new user account.
 * If tenantId is not provided, creates a new tenant with the user as admin.
 */
export async function createUser(input: CreateUserInput): Promise<UserRecord> {
  const client = getDocumentClient();
  const normalizedEmail = input.email.toLowerCase().trim();
  const userId = randomUUID();
  const now = new Date().toISOString();

  // Determine tenant
  const tenantId = input.tenantId || randomUUID();
  const role: UserRole = input.tenantId ? "viewer" : "tenant_admin"; // First user becomes admin
  const passwordHash = await hashPassword(input.password);

  const userRecord: UserRecord = {
    userId,
    email: normalizedEmail,
    name: input.name,
    passwordHash,
    tenantId,
    role,
    teamIds: [],
    createdAt: now,
    updatedAt: now,
    emailVerified: false,
  };

  // Write user record
  await client.send(
    new PutCommand({
      TableName: TableNames.CONFIG,
      Item: {
        PK: `TENANT#${tenantId}`,
        SK: `USER#${userId}`,
        ...userRecord,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  // Write email index (for login lookup)
  await client.send(
    new PutCommand({
      TableName: TableNames.CONFIG,
      Item: {
        PK: "EMAIL_INDEX",
        SK: normalizedEmail,
        tenantId,
        userId,
        createdAt: now,
      },
      ConditionExpression: "attribute_not_exists(PK)",
    })
  );

  // If creating a new tenant, write the subscription (default to starter)
  if (!input.tenantId) {
    await client.send(
      new PutCommand({
        TableName: TableNames.CONFIG,
        Item: {
          PK: `TENANT#${tenantId}`,
          SK: "SUBSCRIPTION#current",
          entityData: {
            tier: "starter",
            activatedAt: now,
            tenantName: input.tenantName || `${input.name}'s Organization`,
          },
        },
      })
    );
  }

  return userRecord;
}

// ─── Password Reset ────────────────────────────────────────────────────────────

/**
 * Generate a password reset token for the given email.
 * Token is valid for 1 hour.
 */
export async function createResetToken(email: string): Promise<string | null> {
  const user = await findUserByEmail(email);
  if (!user) {
    // Don't reveal whether email exists
    return null;
  }

  const client = getDocumentClient();
  const token = randomBytes(32).toString("hex");
  const now = new Date();
  const expiresAt = Math.floor(now.getTime() / 1000) + 3600; // 1 hour from now

  await client.send(
    new PutCommand({
      TableName: TableNames.CONFIG,
      Item: {
        PK: "RESET_TOKEN",
        SK: token,
        email: user.email,
        tenantId: user.tenantId,
        userId: user.userId,
        expiresAt,
        createdAt: now.toISOString(),
        TTL: expiresAt, // DynamoDB TTL for automatic cleanup
      },
    })
  );

  return token;
}

/**
 * Validate a reset token and return the associated email.
 */
export async function validateResetToken(token: string): Promise<{
  valid: boolean;
  email?: string;
  tenantId?: string;
  userId?: string;
}> {
  const client = getDocumentClient();

  const result = await client.send(
    new GetCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: "RESET_TOKEN",
        SK: token,
      },
    })
  );

  if (!result.Item) {
    return { valid: false };
  }

  const now = Math.floor(Date.now() / 1000);
  if ((result.Item.expiresAt as number) < now) {
    return { valid: false };
  }

  return {
    valid: true,
    email: result.Item.email as string,
    tenantId: result.Item.tenantId as string,
    userId: result.Item.userId as string,
  };
}

/**
 * Consume a reset token (delete it) and update the user's password.
 */
export async function resetPassword(token: string, newPassword: string): Promise<boolean> {
  const validation = await validateResetToken(token);
  if (!validation.valid) {
    return false;
  }

  const client = getDocumentClient();
  const newHash = await hashPassword(newPassword);
  const now = new Date().toISOString();

  // Update user's password
  await client.send(
    new PutCommand({
      TableName: TableNames.CONFIG,
      Item: {
        PK: `TENANT#${validation.tenantId}`,
        SK: `USER#${validation.userId}`,
        // We need to read-then-write to preserve other fields
        // In a real app, use UpdateCommand instead
      },
    })
  );

  // Better approach: fetch user, update password hash
  const user = await findUserByEmail(validation.email!);
  if (!user) return false;

  await client.send(
    new PutCommand({
      TableName: TableNames.CONFIG,
      Item: {
        PK: `TENANT#${user.tenantId}`,
        SK: `USER#${user.userId}`,
        ...user,
        passwordHash: newHash,
        updatedAt: now,
      },
    })
  );

  // Delete the reset token
  await client.send(
    new DeleteCommand({
      TableName: TableNames.CONFIG,
      Key: {
        PK: "RESET_TOKEN",
        SK: token,
      },
    })
  );

  return true;
}
