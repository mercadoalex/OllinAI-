/**
 * SQS Client Utility for OllinAI Platform
 *
 * Provides send and receive operations for SQS queues.
 * Supports local development via SQS_ENDPOINT environment variable
 * (for LocalStack or ElasticMQ).
 */

import {
  SQSClient,
  SendMessageCommand,
  SendMessageBatchCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  GetQueueUrlCommand,
  type SendMessageBatchRequestEntry,
  type Message,
} from "@aws-sdk/client-sqs";

/**
 * SQS client configuration. Uses SQS_ENDPOINT env var for local development.
 */
function createSqsClient(): SQSClient {
  const endpoint = process.env.SQS_ENDPOINT;
  const region = process.env.AWS_REGION ?? "us-east-1";

  return new SQSClient({
    region,
    ...(endpoint ? { endpoint } : {}),
  });
}

let sqsClientInstance: SQSClient | null = null;

/**
 * Returns a singleton SQS client instance.
 */
export function getSqsClient(): SQSClient {
  if (!sqsClientInstance) {
    sqsClientInstance = createSqsClient();
  }
  return sqsClientInstance;
}

/**
 * Resets the singleton client instance. Useful for testing.
 */
export function resetSqsClient(): void {
  sqsClientInstance = null;
}

// Queue URL cache to avoid repeated GetQueueUrl calls
const queueUrlCache = new Map<string, string>();

/**
 * Resolves a queue name to its URL. Caches results for subsequent calls.
 */
export async function getQueueUrl(queueName: string): Promise<string> {
  const cached = queueUrlCache.get(queueName);
  if (cached) return cached;

  const client = getSqsClient();
  const response = await client.send(
    new GetQueueUrlCommand({ QueueName: queueName })
  );

  if (!response.QueueUrl) {
    throw new Error(`Could not resolve URL for queue: ${queueName}`);
  }

  queueUrlCache.set(queueName, response.QueueUrl);
  return response.QueueUrl;
}

/**
 * Clears the queue URL cache. Useful for testing.
 */
export function clearQueueUrlCache(): void {
  queueUrlCache.clear();
}

/**
 * Message payload structure for SQS messages sent by OllinAI.
 */
export interface SqsEventMessage {
  /** The type of event (e.g., "deployment.created", "incident.created") */
  eventType: string;
  /** Reference ID to the persisted entity (e.g., eventId, incidentId) */
  entityId: string;
  /** Tenant ID for downstream routing */
  tenantId: string;
  /** ISO 8601 timestamp when the message was produced */
  producedAt: string;
  /** Optional metadata */
  metadata?: Record<string, string>;
}

/**
 * Sends a single message to a named SQS queue.
 *
 * @param queueName - The SQS queue name (not URL)
 * @param message - The event message payload
 * @param options - Optional message attributes
 * @returns The message ID assigned by SQS
 */
export async function sendMessage(
  queueName: string,
  message: SqsEventMessage,
  options?: { delaySeconds?: number; messageGroupId?: string }
): Promise<string> {
  const client = getSqsClient();
  const queueUrl = await getQueueUrl(queueName);

  const response = await client.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(message),
      DelaySeconds: options?.delaySeconds,
      MessageGroupId: options?.messageGroupId,
      MessageAttributes: {
        eventType: {
          DataType: "String",
          StringValue: message.eventType,
        },
        tenantId: {
          DataType: "String",
          StringValue: message.tenantId,
        },
      },
    })
  );

  if (!response.MessageId) {
    throw new Error(`Failed to send message to queue: ${queueName}`);
  }

  return response.MessageId;
}

/**
 * Sends a batch of messages to a named SQS queue.
 * SQS supports up to 10 messages per batch call.
 *
 * @param queueName - The SQS queue name (not URL)
 * @param messages - Array of event messages (max 10)
 * @returns Object with successful and failed message IDs
 */
export async function sendMessageBatch(
  queueName: string,
  messages: SqsEventMessage[]
): Promise<{ successful: string[]; failed: string[] }> {
  if (messages.length === 0) {
    return { successful: [], failed: [] };
  }

  if (messages.length > 10) {
    throw new Error("SQS batch send supports a maximum of 10 messages");
  }

  const client = getSqsClient();
  const queueUrl = await getQueueUrl(queueName);

  const entries: SendMessageBatchRequestEntry[] = messages.map(
    (msg, index) => ({
      Id: `msg-${index}`,
      MessageBody: JSON.stringify(msg),
      MessageAttributes: {
        eventType: {
          DataType: "String",
          StringValue: msg.eventType,
        },
        tenantId: {
          DataType: "String",
          StringValue: msg.tenantId,
        },
      },
    })
  );

  const response = await client.send(
    new SendMessageBatchCommand({
      QueueUrl: queueUrl,
      Entries: entries,
    })
  );

  return {
    successful: (response.Successful ?? []).map((s) => s.MessageId!),
    failed: (response.Failed ?? []).map((f) => f.Id!),
  };
}

/**
 * Receives messages from a named SQS queue.
 *
 * @param queueName - The SQS queue name (not URL)
 * @param options - Receive configuration
 * @returns Array of received messages
 */
export async function receiveMessages(
  queueName: string,
  options?: {
    maxMessages?: number;
    waitTimeSeconds?: number;
    visibilityTimeout?: number;
  }
): Promise<Message[]> {
  const client = getSqsClient();
  const queueUrl = await getQueueUrl(queueName);

  const response = await client.send(
    new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: options?.maxMessages ?? 10,
      WaitTimeSeconds: options?.waitTimeSeconds ?? 5,
      VisibilityTimeout: options?.visibilityTimeout,
      MessageAttributeNames: ["All"],
    })
  );

  return response.Messages ?? [];
}

/**
 * Deletes a message from a queue after successful processing.
 *
 * @param queueName - The SQS queue name (not URL)
 * @param receiptHandle - The receipt handle from the received message
 */
export async function deleteMessage(
  queueName: string,
  receiptHandle: string
): Promise<void> {
  const client = getSqsClient();
  const queueUrl = await getQueueUrl(queueName);

  await client.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: receiptHandle,
    })
  );
}

/**
 * Parses the body of a received SQS message into an SqsEventMessage.
 *
 * @param message - The raw SQS message
 * @returns Parsed event message
 */
export function parseMessageBody(message: Message): SqsEventMessage {
  if (!message.Body) {
    throw new Error("Message has no body");
  }
  return JSON.parse(message.Body) as SqsEventMessage;
}
