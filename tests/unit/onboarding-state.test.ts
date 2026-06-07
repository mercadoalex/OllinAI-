import { describe, it, expect, beforeEach, vi } from "vitest";
import { ConditionalCheckFailedException } from "@aws-sdk/client-dynamodb";

const mockSend = vi.fn();
vi.mock("@/lib/dynamo/client", () => ({
  getDocumentClient: () => ({ send: mockSend }),
  TableNames: {
    EVENTS: "ollinai-events",
    INCIDENTS: "ollinai-incidents",
    METRICS: "ollinai-metrics",
    CONFIG: "ollinai-config",
    AUDIT: "ollinai-audit",
  },
}));

vi.mock("@aws-sdk/lib-dynamodb", () => ({
  GetCommand: vi.fn().mockImplementation((input) => ({ input, type: "get" })),
  PutCommand: vi.fn().mockImplementation((input) => ({ input, type: "put" })),
  UpdateCommand: vi.fn().mockImplementation((input) => ({ input, type: "update" })),
}));

import {
  initializeOnboardingState,
  getOnboardingState,
  completeStep,
  skipOnboarding,
  resumeOnboarding,
  dismissBanner,
  ONBOARDING_STEPS,
} from "@/lib/onboarding/state";
import type { OnboardingState } from "@/lib/onboarding/state";

describe("Onboarding State Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-15T10:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("ONBOARDING_STEPS", () => {
    it("defines the correct step sequence", () => {
      expect(ONBOARDING_STEPS).toEqual([
        "integration_created",
        "pipeline_configured",
        "first_event_received",
      ]);
    });
  });

  describe("initializeOnboardingState", () => {
    it("creates a new state with all steps incomplete", async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await initializeOnboardingState("tenant-1");

      expect(result).toEqual({
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: false },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-15T10:00:00.000Z",
        updatedAt: "2024-03-15T10:00:00.000Z",
      });
    });

    it("uses PutCommand with condition to prevent overwriting", async () => {
      mockSend.mockResolvedValueOnce({});

      await initializeOnboardingState("tenant-1");

      expect(mockSend).toHaveBeenCalledTimes(1);
      const call = mockSend.mock.calls[0][0];
      expect(call.input.TableName).toBe("ollinai-config");
      expect(call.input.Item.PK).toBe("TENANT#tenant-1");
      expect(call.input.Item.SK).toBe("ONBOARDING#state");
      expect(call.input.ConditionExpression).toBe(
        "attribute_not_exists(PK) AND attribute_not_exists(SK)"
      );
    });

    it("returns existing state if record already exists", async () => {
      const existingState: OnboardingState = {
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: true, completedAt: "2024-03-15T09:00:00.000Z" },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-14T10:00:00.000Z",
        updatedAt: "2024-03-15T09:00:00.000Z",
      };

      // First call: PutCommand fails with ConditionalCheckFailedException
      const conditionalError = new ConditionalCheckFailedException({
        message: "The conditional request failed",
        $metadata: {},
      });
      mockSend.mockRejectedValueOnce(conditionalError);

      // Second call: GetCommand returns existing state
      mockSend.mockResolvedValueOnce({
        Item: { entityData: existingState },
      });

      const result = await initializeOnboardingState("tenant-1");
      expect(result).toEqual(existingState);
    });

    it("retries with exponential backoff on failure", async () => {
      vi.useRealTimers(); // Use real timers due to async sleep behavior
      const error = new Error("DynamoDB timeout");

      // First two attempts fail, third succeeds
      mockSend.mockRejectedValueOnce(error);
      mockSend.mockRejectedValueOnce(error);
      mockSend.mockResolvedValueOnce({});

      const result = await initializeOnboardingState("tenant-1");

      expect(result.tenantId).toBe("tenant-1");
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("throws after all retries are exhausted", async () => {
      vi.useRealTimers(); // Use real timers for this test due to async rejection handling
      const error = new Error("DynamoDB timeout");
      // Mock all three attempts to fail
      mockSend.mockRejectedValueOnce(error);
      mockSend.mockRejectedValueOnce(error);
      mockSend.mockRejectedValueOnce(error);

      await expect(initializeOnboardingState("tenant-1")).rejects.toThrow(
        "Failed to initialize onboarding state after 3 attempts"
      );
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it("throws on empty tenantId", async () => {
      await expect(initializeOnboardingState("")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });

    it("throws on whitespace-only tenantId", async () => {
      await expect(initializeOnboardingState("   ")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });
  });

  describe("getOnboardingState", () => {
    it("returns the state when record exists", async () => {
      const state: OnboardingState = {
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: false },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-15T10:00:00.000Z",
        updatedAt: "2024-03-15T10:00:00.000Z",
      };

      mockSend.mockResolvedValueOnce({
        Item: { PK: "TENANT#tenant-1", SK: "ONBOARDING#state", entityData: state },
      });

      const result = await getOnboardingState("tenant-1");
      expect(result).toEqual(state);
    });

    it("returns null when no record exists", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getOnboardingState("tenant-1");
      expect(result).toBeNull();
    });

    it("uses correct key structure", async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await getOnboardingState("tenant-abc");

      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key.PK).toBe("TENANT#tenant-abc");
      expect(call.input.Key.SK).toBe("ONBOARDING#state");
      expect(call.input.TableName).toBe("ollinai-config");
    });

    it("throws on empty tenantId", async () => {
      await expect(getOnboardingState("")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });
  });

  describe("completeStep", () => {
    it("marks a step as complete with timestamp", async () => {
      const updatedState: OnboardingState = {
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: true, completedAt: "2024-03-15T10:00:00.000Z" },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-14T10:00:00.000Z",
        updatedAt: "2024-03-15T10:00:00.000Z",
      };

      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: updatedState },
      });

      const result = await completeStep("tenant-1", "integration_created");
      expect(result).toEqual(updatedState);
    });

    it("uses conditional write to prevent overwriting completed steps", async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: {
          entityData: {
            tenantId: "tenant-1",
            status: "in_progress",
            steps: {
              integration_created: { completed: true, completedAt: "2024-03-15T10:00:00.000Z" },
              pipeline_configured: { completed: false },
              first_event_received: { completed: false },
            },
            createdAt: "2024-03-14T10:00:00.000Z",
            updatedAt: "2024-03-15T10:00:00.000Z",
          },
        },
      });

      await completeStep("tenant-1", "integration_created");

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ConditionExpression).toBe(
        "attribute_exists(PK) AND entityData.steps.#step.completed = :false"
      );
      expect(call.input.ExpressionAttributeNames["#step"]).toBe("integration_created");
    });

    it("returns current state when step is already complete (ConditionalCheckFailed)", async () => {
      const existingState: OnboardingState = {
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: true, completedAt: "2024-03-15T09:00:00.000Z" },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-14T10:00:00.000Z",
        updatedAt: "2024-03-15T09:00:00.000Z",
      };

      // First call: UpdateCommand fails with ConditionalCheckFailedException
      const conditionalError = new ConditionalCheckFailedException({
        message: "The conditional request failed",
        $metadata: {},
      });
      mockSend.mockRejectedValueOnce(conditionalError);

      // Second call: GetCommand returns existing state
      mockSend.mockResolvedValueOnce({
        Item: { entityData: existingState },
      });

      const result = await completeStep("tenant-1", "integration_created");
      expect(result).toEqual(existingState);
    });

    it("updates status to completed when all steps are done", async () => {
      const allCompleteState: OnboardingState = {
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: true, completedAt: "2024-03-15T09:00:00.000Z" },
          pipeline_configured: { completed: true, completedAt: "2024-03-15T09:30:00.000Z" },
          first_event_received: { completed: true, completedAt: "2024-03-15T10:00:00.000Z" },
        },
        createdAt: "2024-03-14T10:00:00.000Z",
        updatedAt: "2024-03-15T10:00:00.000Z",
      };

      // First call: step completion returns all steps complete
      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: allCompleteState },
      });

      // Second call: status update to completed
      const finalState = { ...allCompleteState, status: "completed" };
      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: finalState },
      });

      const result = await completeStep("tenant-1", "first_event_received");
      expect(result.status).toBe("completed");
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it("throws on invalid step name", async () => {
      await expect(
        completeStep("tenant-1", "invalid_step" as any)
      ).rejects.toThrow("Invalid step name: invalid_step");
    });

    it("throws on empty tenantId", async () => {
      await expect(completeStep("", "integration_created")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });
  });

  describe("skipOnboarding", () => {
    it("sets status to skipped with skippedAt timestamp", async () => {
      const skippedState: OnboardingState = {
        tenantId: "tenant-1",
        status: "skipped",
        steps: {
          integration_created: { completed: false },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-15T10:00:00.000Z",
        updatedAt: "2024-03-15T10:00:00.000Z",
        skippedAt: "2024-03-15T10:00:00.000Z",
      };

      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: skippedState },
      });

      const result = await skipOnboarding("tenant-1");
      expect(result.status).toBe("skipped");
      expect(result.skippedAt).toBe("2024-03-15T10:00:00.000Z");
    });

    it("uses UpdateCommand with correct expression", async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: { status: "skipped" } },
      });

      await skipOnboarding("tenant-1");

      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key.PK).toBe("TENANT#tenant-1");
      expect(call.input.Key.SK).toBe("ONBOARDING#state");
      expect(call.input.ConditionExpression).toBe("attribute_exists(PK)");
      expect(call.input.ExpressionAttributeValues[":skipped"]).toBe("skipped");
    });

    it("throws on empty tenantId", async () => {
      await expect(skipOnboarding("")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });
  });

  describe("resumeOnboarding", () => {
    it("sets status back to in_progress and removes skippedAt", async () => {
      const resumedState: OnboardingState = {
        tenantId: "tenant-1",
        status: "in_progress",
        steps: {
          integration_created: { completed: false },
          pipeline_configured: { completed: false },
          first_event_received: { completed: false },
        },
        createdAt: "2024-03-15T10:00:00.000Z",
        updatedAt: "2024-03-15T10:00:00.000Z",
      };

      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: resumedState },
      });

      const result = await resumeOnboarding("tenant-1");
      expect(result.status).toBe("in_progress");
      expect(result.skippedAt).toBeUndefined();
    });

    it("uses REMOVE for skippedAt field", async () => {
      mockSend.mockResolvedValueOnce({
        Attributes: { entityData: { status: "in_progress" } },
      });

      await resumeOnboarding("tenant-1");

      const call = mockSend.mock.calls[0][0];
      expect(call.input.UpdateExpression).toContain("REMOVE entityData.skippedAt");
    });

    it("throws on empty tenantId", async () => {
      await expect(resumeOnboarding("")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });
  });

  describe("dismissBanner", () => {
    it("sets bannerDismissed to true", async () => {
      mockSend.mockResolvedValueOnce({});

      await dismissBanner("tenant-1");

      const call = mockSend.mock.calls[0][0];
      expect(call.input.Key.PK).toBe("TENANT#tenant-1");
      expect(call.input.Key.SK).toBe("ONBOARDING#state");
      expect(call.input.UpdateExpression).toContain("entityData.bannerDismissed = :true");
      expect(call.input.ExpressionAttributeValues[":true"]).toBe(true);
    });

    it("requires the record to exist", async () => {
      mockSend.mockResolvedValueOnce({});

      await dismissBanner("tenant-1");

      const call = mockSend.mock.calls[0][0];
      expect(call.input.ConditionExpression).toBe("attribute_exists(PK)");
    });

    it("throws on empty tenantId", async () => {
      await expect(dismissBanner("")).rejects.toThrow(
        "tenantId is required and cannot be empty"
      );
    });
  });
});
