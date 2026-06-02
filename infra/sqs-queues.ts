/**
 * SQS Queue Definitions for OllinAI Platform
 *
 * Defines three main queues with Dead Letter Queues (DLQ):
 * - deployment-events: Deployment event processing
 * - incidents: Incident ingestion and correlation
 * - agent-telemetry: eBPF agent telemetry batches
 *
 * Each queue has a DLQ that receives messages after 3 failed processing attempts.
 * These definitions can be used with AWS CDK, CloudFormation, or LocalStack for local dev.
 */

export interface QueueDefinition {
  queueName: string;
  dlqName: string;
  /** Max receive count before message moves to DLQ */
  maxReceiveCount: number;
  /** Visibility timeout in seconds */
  visibilityTimeoutSeconds: number;
  /** Message retention period in seconds (default 4 days) */
  messageRetentionSeconds: number;
  /** Delay before message becomes visible (seconds) */
  delaySeconds: number;
}

/**
 * All SQS queue definitions for the OllinAI platform.
 */
export const sqsQueueDefinitions: QueueDefinition[] = [
  {
    queueName: "ollinai-deployment-events",
    dlqName: "ollinai-deployment-events-dlq",
    maxReceiveCount: 3,
    visibilityTimeoutSeconds: 60,
    messageRetentionSeconds: 345600, // 4 days
    delaySeconds: 0,
  },
  {
    queueName: "ollinai-incidents",
    dlqName: "ollinai-incidents-dlq",
    maxReceiveCount: 3,
    visibilityTimeoutSeconds: 60,
    messageRetentionSeconds: 345600,
    delaySeconds: 0,
  },
  {
    queueName: "ollinai-agent-telemetry",
    dlqName: "ollinai-agent-telemetry-dlq",
    maxReceiveCount: 3,
    visibilityTimeoutSeconds: 120, // longer for telemetry processing
    messageRetentionSeconds: 345600,
    delaySeconds: 0,
  },
];

/**
 * Generates CloudFormation-compatible resource definitions for SQS queues.
 * Useful for infrastructure-as-code deployments (CDK, SAM, raw CloudFormation).
 */
export function generateCloudFormationResources() {
  const resources: Record<string, unknown> = {};

  for (const queue of sqsQueueDefinitions) {
    const dlqLogicalId = toCfnLogicalId(queue.dlqName);
    const queueLogicalId = toCfnLogicalId(queue.queueName);

    // Dead Letter Queue
    resources[dlqLogicalId] = {
      Type: "AWS::SQS::Queue",
      Properties: {
        QueueName: queue.dlqName,
        MessageRetentionPeriod: 1209600, // 14 days for DLQ
      },
    };

    // Main Queue with redrive policy pointing to DLQ
    resources[queueLogicalId] = {
      Type: "AWS::SQS::Queue",
      Properties: {
        QueueName: queue.queueName,
        VisibilityTimeout: queue.visibilityTimeoutSeconds,
        MessageRetentionPeriod: queue.messageRetentionSeconds,
        DelaySeconds: queue.delaySeconds,
        RedrivePolicy: {
          deadLetterTargetArn: { "Fn::GetAtt": [dlqLogicalId, "Arn"] },
          maxReceiveCount: queue.maxReceiveCount,
        },
      },
      DependsOn: [dlqLogicalId],
    };
  }

  return resources;
}

/**
 * Queue name constants for use across the application.
 */
export const QUEUE_NAMES = {
  DEPLOYMENT_EVENTS: "ollinai-deployment-events",
  INCIDENTS: "ollinai-incidents",
  AGENT_TELEMETRY: "ollinai-agent-telemetry",
  DEPLOYMENT_EVENTS_DLQ: "ollinai-deployment-events-dlq",
  INCIDENTS_DLQ: "ollinai-incidents-dlq",
  AGENT_TELEMETRY_DLQ: "ollinai-agent-telemetry-dlq",
} as const;

/**
 * Converts a queue name to a CloudFormation-compatible logical ID.
 * e.g. "ollinai-deployment-events-dlq" -> "OllinaiDeploymentEventsDlq"
 */
function toCfnLogicalId(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
