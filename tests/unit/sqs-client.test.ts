import { describe, it, expect, beforeEach, vi, type Mock } from "vitest";

// Mock the SQS client module
const mockSend = vi.fn();

vi.mock("@aws-sdk/client-sqs", () => ({
  SQSClient: vi.fn().mockImplementation(() => ({ send: mockSend })),
  SendMessageCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "SendMessage" })),
  SendMessageBatchCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "SendMessageBatch" })),
  ReceiveMessageCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "ReceiveMessage" })),
  DeleteMessageCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "DeleteMessage" })),
  GetQueueUrlCommand: vi.fn().mockImplementation((input) => ({ ...input, _type: "GetQueueUrl" })),
}));

import {
  getSqsClient,
  resetSqsClient,
  getQueueUrl,
  clearQueueUrlCache,
  sendMessage,
  sendMessageBatch,
  receiveMessages,
  deleteMessage,
  parseMessageBody,
  type SqsEventMessage,
} from "@/lib/sqs/client";

describe("SQS Client", () => {
  beforeEach(() => {
    resetSqsClient();
    clearQueueUrlCache();
    mockSend.mockReset();
  });

  describe("getSqsClient", () => {
    it("returns a singleton instance", () => {
      const client1 = getSqsClient();
      const client2 = getSqsClient();
      expect(client1).toBe(client2);
    });

    it("returns a new instance after reset", () => {
      const client1 = getSqsClient();
      resetSqsClient();
      const client2 = getSqsClient();
      expect(client1).not.toBe(client2);
    });
  });

  describe("getQueueUrl", () => {
    it("resolves queue URL and caches it", async () => {
      mockSend.mockResolvedValueOnce({
        QueueUrl: "https://sqs.us-east-1.amazonaws.com/123/test-queue",
      });

      const url = await getQueueUrl("test-queue");
      expect(url).toBe("https://sqs.us-east-1.amazonaws.com/123/test-queue");

      // Second call should use cache, not call SQS again
      const url2 = await getQueueUrl("test-queue");
      expect(url2).toBe(url);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("throws when queue URL is not returned", async () => {
      mockSend.mockResolvedValueOnce({ QueueUrl: undefined });

      await expect(getQueueUrl("nonexistent")).rejects.toThrow(
        "Could not resolve URL for queue: nonexistent"
      );
    });
  });

  describe("sendMessage", () => {
    it("sends a message and returns the message ID", async () => {
      mockSend
        .mockResolvedValueOnce({ QueueUrl: "https://sqs.example.com/queue" })
        .mockResolvedValueOnce({ MessageId: "msg-123" });

      const message: SqsEventMessage = {
        eventType: "deployment.created",
        entityId: "evt-001",
        tenantId: "tenant-abc",
        producedAt: "2024-01-01T00:00:00.000Z",
      };

      const messageId = await sendMessage("test-queue", message);
      expect(messageId).toBe("msg-123");
    });

    it("throws when MessageId is not returned", async () => {
      mockSend
        .mockResolvedValueOnce({ QueueUrl: "https://sqs.example.com/queue" })
        .mockResolvedValueOnce({ MessageId: undefined });

      const message: SqsEventMessage = {
        eventType: "deployment.created",
        entityId: "evt-001",
        tenantId: "tenant-abc",
        producedAt: "2024-01-01T00:00:00.000Z",
      };

      await expect(sendMessage("test-queue", message)).rejects.toThrow(
        "Failed to send message to queue: test-queue"
      );
    });
  });

  describe("sendMessageBatch", () => {
    it("returns empty results for empty array", async () => {
      const result = await sendMessageBatch("test-queue", []);
      expect(result).toEqual({ successful: [], failed: [] });
    });

    it("rejects batch larger than 10 messages", async () => {
      const messages: SqsEventMessage[] = Array.from({ length: 11 }, (_, i) => ({
        eventType: "test",
        entityId: `id-${i}`,
        tenantId: "tenant-1",
        producedAt: "2024-01-01T00:00:00.000Z",
      }));

      await expect(sendMessageBatch("test-queue", messages)).rejects.toThrow(
        "SQS batch send supports a maximum of 10 messages"
      );
    });

    it("sends batch and returns results", async () => {
      mockSend
        .mockResolvedValueOnce({ QueueUrl: "https://sqs.example.com/queue" })
        .mockResolvedValueOnce({
          Successful: [{ MessageId: "msg-1" }, { MessageId: "msg-2" }],
          Failed: [],
        });

      const messages: SqsEventMessage[] = [
        {
          eventType: "deployment.created",
          entityId: "evt-001",
          tenantId: "tenant-abc",
          producedAt: "2024-01-01T00:00:00.000Z",
        },
        {
          eventType: "incident.created",
          entityId: "inc-001",
          tenantId: "tenant-abc",
          producedAt: "2024-01-01T00:01:00.000Z",
        },
      ];

      const result = await sendMessageBatch("test-queue", messages);
      expect(result.successful).toEqual(["msg-1", "msg-2"]);
      expect(result.failed).toEqual([]);
    });
  });

  describe("receiveMessages", () => {
    it("returns messages from queue", async () => {
      mockSend
        .mockResolvedValueOnce({ QueueUrl: "https://sqs.example.com/queue" })
        .mockResolvedValueOnce({
          Messages: [
            { MessageId: "msg-1", Body: '{"eventType":"test"}' },
          ],
        });

      const messages = await receiveMessages("test-queue");
      expect(messages).toHaveLength(1);
      expect(messages[0].MessageId).toBe("msg-1");
    });

    it("returns empty array when no messages available", async () => {
      mockSend
        .mockResolvedValueOnce({ QueueUrl: "https://sqs.example.com/queue" })
        .mockResolvedValueOnce({ Messages: undefined });

      const messages = await receiveMessages("test-queue");
      expect(messages).toEqual([]);
    });
  });

  describe("deleteMessage", () => {
    it("deletes a message by receipt handle", async () => {
      mockSend
        .mockResolvedValueOnce({ QueueUrl: "https://sqs.example.com/queue" })
        .mockResolvedValueOnce({});

      await expect(
        deleteMessage("test-queue", "receipt-handle-123")
      ).resolves.not.toThrow();
    });
  });

  describe("parseMessageBody", () => {
    it("parses valid message body", () => {
      const message = {
        Body: JSON.stringify({
          eventType: "deployment.created",
          entityId: "evt-001",
          tenantId: "tenant-abc",
          producedAt: "2024-01-01T00:00:00.000Z",
        }),
      };

      const parsed = parseMessageBody(message as any);
      expect(parsed.eventType).toBe("deployment.created");
      expect(parsed.entityId).toBe("evt-001");
      expect(parsed.tenantId).toBe("tenant-abc");
    });

    it("throws when message has no body", () => {
      expect(() => parseMessageBody({} as any)).toThrow("Message has no body");
    });
  });
});
