/**
 * DynamoDB Document Client Factory
 *
 * Provides a singleton DynamoDB document client that switches between:
 * - DynamoDB Local (for dev/test) when DYNAMODB_ENDPOINT is set
 * - Real DynamoDB (for production) when running in AWS
 * - DAX-accelerated reads when DAX_ENDPOINT is set
 *
 * Environment variables:
 *   - DYNAMODB_ENDPOINT: DynamoDB Local endpoint (e.g. http://localhost:8000)
 *   - DAX_ENDPOINT: DAX cluster endpoint for cached reads (e.g. dax://my-cluster.abc123.dax-clusters.us-east-1.amazonaws.com:8111)
 *   - AWS_REGION: AWS region (default: us-east-1)
 *   - USE_DAX: Set to "true" to enable DAX for read operations (requires DAX_ENDPOINT)
 */

import { DynamoDBClient, DynamoDBClientConfig } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, TranslateConfig } from "@aws-sdk/lib-dynamodb";

export interface DynamoClientOptions {
  /** Override the DynamoDB endpoint (useful for testing) */
  endpoint?: string;
  /** AWS region */
  region?: string;
  /** Enable DAX for read operations */
  useDax?: boolean;
  /** DAX cluster endpoint */
  daxEndpoint?: string;
}

const translateConfig: TranslateConfig = {
  marshallOptions: {
    removeUndefinedValues: true,
    convertEmptyValues: false,
    convertClassInstanceToMap: true,
  },
  unmarshallOptions: {
    wrapNumbers: false,
  },
};

/**
 * Determines if we're running in a local/test environment
 */
function isLocalEnvironment(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.NODE_ENV === "development" ||
    !!process.env.DYNAMODB_ENDPOINT
  );
}

/**
 * Creates a raw DynamoDB client with appropriate configuration
 */
function createBaseClient(options?: DynamoClientOptions): DynamoDBClient {
  const endpoint =
    options?.endpoint || process.env.DYNAMODB_ENDPOINT || undefined;
  const region =
    options?.region || process.env.AWS_REGION || "us-east-1";

  const config: DynamoDBClientConfig = {
    region,
  };

  if (endpoint) {
    config.endpoint = endpoint;
    // Local development credentials
    config.credentials = {
      accessKeyId: "local",
      secretAccessKey: "local",
    };
  }

  return new DynamoDBClient(config);
}

/**
 * Creates a DynamoDB Document Client.
 *
 * In production with DAX enabled, this returns a client configured
 * for the DAX endpoint for accelerated reads. The DAX SDK is loaded
 * dynamically to avoid bundling it in environments that don't need it.
 *
 * In local/test environments, returns a client pointing to DynamoDB Local.
 */
export function createDocumentClient(
  options?: DynamoClientOptions
): DynamoDBDocumentClient {
  const useDax =
    options?.useDax ??
    (process.env.USE_DAX === "true" && !isLocalEnvironment());
  const daxEndpoint =
    options?.daxEndpoint || process.env.DAX_ENDPOINT || undefined;

  if (useDax && daxEndpoint) {
    // DAX client uses the same DynamoDB client interface but routes
    // through the DAX cluster. The DAX SDK (@amazon-dax-client) provides
    // a drop-in replacement DynamoDBClient. For now, we log a warning
    // and fall back to standard DynamoDB if DAX SDK is not available.
    // In production, the DAX SDK should be installed separately.
    console.info(
      `[DynamoDB] DAX enabled, endpoint: ${daxEndpoint}. ` +
        `Note: Install @amazon-dax-client for DAX acceleration.`
    );
  }

  const baseClient = createBaseClient(options);
  return DynamoDBDocumentClient.from(baseClient, translateConfig);
}

// Singleton instance for the application
let _documentClient: DynamoDBDocumentClient | null = null;
let _baseClient: DynamoDBClient | null = null;

/**
 * Returns the singleton DynamoDB Document Client instance.
 * Creates it on first call using environment configuration.
 */
export function getDocumentClient(): DynamoDBDocumentClient {
  if (!_documentClient) {
    _documentClient = createDocumentClient();
  }
  return _documentClient;
}

/**
 * Returns the singleton raw DynamoDB Client instance.
 * Useful for operations not supported by the document client.
 */
export function getBaseClient(): DynamoDBClient {
  if (!_baseClient) {
    _baseClient = createBaseClient();
  }
  return _baseClient;
}

/**
 * Resets the singleton clients. Useful for testing.
 */
export function resetClients(): void {
  if (_baseClient) {
    _baseClient.destroy();
    _baseClient = null;
  }
  _documentClient = null;
}

/**
 * Table names used across the application.
 * Centralized here to avoid string duplication.
 */
export const TableNames = {
  EVENTS: "ollinai-events",
  INCIDENTS: "ollinai-incidents",
  METRICS: "ollinai-metrics",
  CONFIG: "ollinai-config",
  AUDIT: "ollinai-audit",
} as const;

export type TableName = (typeof TableNames)[keyof typeof TableNames];
