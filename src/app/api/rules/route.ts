/**
 * Custom Rule Authoring API — Rule CRUD
 *
 * Validate YAML rule syntax on submission.
 * Provides baseline rules: credential access, exfiltration, crypto miner, malicious domains.
 *
 * Requirements: 18.3, 18.4
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface DetectionRule {
  id: string;
  name: string;
  description: string;
  severity: "info" | "warning" | "critical";
  match: {
    processAncestry?: {
      ancestorCommand: string;
      descendantCommand?: string;
      maxDepth?: number;
    };
    fileAccess?: {
      paths: string[];
      operation?: "read" | "write";
    };
    networkDestination?: {
      domains?: string[];
      ips?: string[];
      ports?: number[];
    };
    resourceThreshold?: {
      maxCpuPercent?: number;
      maxMemoryBytes?: number;
    };
  };
  conditions?: {
    operator: "and" | "or";
  };
}

// ─── Baseline Rules ────────────────────────────────────────────────────────────

const BASELINE_RULES: DetectionRule[] = [
  {
    id: "baseline-cred-access-001",
    name: "Credential access from package installer",
    description: "Detects credential file reads by descendants of build tools",
    severity: "critical",
    match: {
      processAncestry: {
        ancestorCommand: "^(npm|pip|cargo|go|yarn|pnpm)\\s+(install|build|get|add|ci)",
      },
      fileAccess: {
        paths: [
          "~/.aws/credentials",
          "~/.docker/config.json",
          "~/.ssh/id_rsa",
          "~/.ssh/id_ed25519",
          "**/*.pem",
        ],
        operation: "read",
      },
    },
    conditions: { operator: "and" },
  },
  {
    id: "baseline-exfiltration-001",
    name: "Data exfiltration via network",
    description: "Large outbound data transfer during build process",
    severity: "critical",
    match: {
      processAncestry: {
        ancestorCommand: "^(npm|pip|cargo|go|yarn)\\s+(install|build|get)",
      },
      networkDestination: {
        ports: [4444, 8888, 9999],
      },
    },
    conditions: { operator: "and" },
  },
  {
    id: "baseline-cryptominer-001",
    name: "Crypto miner detection",
    description: "Detects suspected cryptocurrency mining based on resource usage",
    severity: "critical",
    match: {
      resourceThreshold: {
        maxCpuPercent: 90.0,
      },
      networkDestination: {
        ports: [3333, 5555, 7777, 9999],
      },
    },
    conditions: { operator: "and" },
  },
  {
    id: "baseline-malicious-domain-001",
    name: "Connection to known malicious domain",
    description: "Detects outbound connections to known malicious infrastructure",
    severity: "warning",
    match: {
      networkDestination: {
        domains: [
          ".malware.net",
          ".evil-infra.com",
          ".crypto-pool.org",
          ".c2-server.io",
        ],
      },
    },
  },
];

// ─── Validation ────────────────────────────────────────────────────────────────

function validateRule(rule: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  const r = rule as Record<string, unknown>;

  if (!r.id || typeof r.id !== "string") {
    errors.push("id is required and must be a string");
  }
  if (!r.name || typeof r.name !== "string") {
    errors.push("name is required and must be a string");
  }
  if (!r.severity || !["info", "warning", "critical"].includes(r.severity as string)) {
    errors.push("severity must be one of: info, warning, critical");
  }
  if (!r.match || typeof r.match !== "object") {
    errors.push("match block is required");
  } else {
    const match = r.match as Record<string, unknown>;
    const hasMatchType =
      match.processAncestry || match.fileAccess || match.networkDestination || match.resourceThreshold;
    if (!hasMatchType) {
      errors.push("match must contain at least one of: processAncestry, fileAccess, networkDestination, resourceThreshold");
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/rules — List rules (includes baseline + custom)
 */
export async function GET(request: NextRequest) {
  const includeBaseline = request.nextUrl.searchParams.get("includeBaseline") !== "false";

  // In production: query tenant-specific rules from DynamoDB
  const customRules: DetectionRule[] = [];

  const rules = includeBaseline
    ? [...BASELINE_RULES, ...customRules]
    : customRules;

  return NextResponse.json({
    data: rules,
    pagination: {
      totalCount: rules.length,
      currentPage: 1,
      pageSize: rules.length,
      hasMore: false,
    },
    baseline: BASELINE_RULES.length,
    custom: customRules.length,
  });
}

/**
 * POST /api/rules — Create a custom rule
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validation = validateRule(body);

    if (!validation.valid) {
      return NextResponse.json(
        { error: "Invalid rule", details: validation.errors },
        { status: 400 }
      );
    }

    // In production: persist to DynamoDB, trigger bundle rebuild
    const rule = body as DetectionRule;

    return NextResponse.json(
      {
        id: rule.id,
        status: "created",
        message: "Rule created successfully. Trigger bundle publish to distribute.",
      },
      { status: 201 }
    );
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }
}
