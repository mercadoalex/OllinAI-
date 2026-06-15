/**
 * Structured Logger — OllinAI
 *
 * Provides structured JSON logging with request ID propagation.
 * Every log entry includes: timestamp, level, message, requestId, and optional metadata.
 *
 * Usage:
 *   import { createLogger } from "@/lib/logger";
 *   const log = createLogger("api/webhooks");
 *   log.info("Event received", { eventId, tenantId });
 *   log.error("Processing failed", { error: err.message, eventId });
 */

import { randomUUID } from "crypto";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  requestId?: string;
  tenantId?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(meta: Record<string, unknown>): Logger;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const CURRENT_LOG_LEVEL: LogLevel =
  (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[CURRENT_LOG_LEVEL];
}

// ─── Logger Implementation ─────────────────────────────────────────────────────

function emit(entry: LogEntry): void {
  const output = JSON.stringify(entry);

  switch (entry.level) {
    case "error":
      console.error(output);
      break;
    case "warn":
      console.warn(output);
      break;
    default:
      console.info(output);
  }
}

function createLoggerInstance(
  service: string,
  baseMeta: Record<string, unknown> = {}
): Logger {
  function log(
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>
  ): void {
    if (!shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service,
      message,
      ...baseMeta,
      ...meta,
    };

    emit(entry);
  }

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
    child: (childMeta) =>
      createLoggerInstance(service, { ...baseMeta, ...childMeta }),
  };
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Creates a logger for a specific service/module.
 *
 * @param service - The service or module name (e.g., "api/webhooks", "lambda/risk-scorer")
 * @returns A Logger instance
 */
export function createLogger(service: string): Logger {
  return createLoggerInstance(service);
}

/**
 * Generates a unique request ID for tracing a request through the system.
 * Format: "req_{uuid}" for easy identification in logs.
 */
export function generateRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").substring(0, 16)}`;
}

/**
 * Creates a logger bound to a specific request ID.
 * Use this at the start of each API route handler.
 *
 * @example
 * ```ts
 * export async function POST(request: NextRequest) {
 *   const log = createRequestLogger("api/webhooks/deployments");
 *   log.info("Webhook received", { method: "POST" });
 *   // ... all subsequent logs include the same requestId
 * }
 * ```
 */
export function createRequestLogger(
  service: string,
  meta?: { tenantId?: string; userId?: string }
): Logger {
  const requestId = generateRequestId();
  return createLoggerInstance(service, { requestId, ...meta });
}
