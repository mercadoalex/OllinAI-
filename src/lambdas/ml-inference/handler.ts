/**
 * ML Inference Lambda Handler
 *
 * Calls SageMaker endpoint for prediction (simulated).
 * Returns Prediction_Score (0.0-1.0) with ≤200ms latency target.
 * Falls back to rule-based scoring when model unavailable or <100 events / <10 incidents.
 * Labels source as "ml_model" or "rule_engine".
 *
 * Requirements: 15.4, 15.8, 16.1, 16.8
 */

import type { SQSEvent } from "aws-lambda";
import {
  constructFeatureVector,
  ruleBasedScore,
  normalizeFeatureVector,
  type FeatureInput,
  type FeatureVector,
} from "@/lib/ml/features";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface PredictionResult {
  predictionScore: number;
  modelVersion: string;
  inferenceLatencyMs: number;
  source: "ml_model" | "rule_engine";
  factors?: Record<string, number>;
}

export interface InferenceRequest {
  tenantId: string;
  eventId: string;
  featureInput: FeatureInput;
  /** Total historical events for this tenant */
  totalEvents: number;
  /** Total historical incidents for this tenant */
  totalIncidents: number;
}

interface ModelConfig {
  endpointName: string;
  modelVersion: string;
  available: boolean;
}

// ─── Configuration ─────────────────────────────────────────────────────────────

const MIN_EVENTS_FOR_ML = 100;
const MIN_INCIDENTS_FOR_ML = 10;
const LATENCY_TARGET_MS = 200;

// ─── Simulated SageMaker Client ────────────────────────────────────────────────

/**
 * Simulated SageMaker inference call.
 * In production, this would use @aws-sdk/client-sagemaker-runtime InvokeEndpoint.
 */
async function invokeSageMakerEndpoint(
  _endpointName: string,
  features: number[]
): Promise<{ score: number; latencyMs: number } | null> {
  const startTime = Date.now();

  // Simulate ML model prediction based on feature values
  // This is a placeholder — actual implementation calls SageMaker
  const weightedSum = features.reduce((sum, val, idx) => {
    const weights = [0.10, 0.10, 0.05, 0.05, 0.25, 0.15, 0.10, 0.10, 0.10];
    return sum + val * (weights[idx] ?? 0.1);
  }, 0);

  const score = Math.min(1.0, Math.max(0.0, weightedSum));
  const latencyMs = Date.now() - startTime + Math.random() * 5; // Simulated low latency

  return { score, latencyMs };
}

/**
 * Check if the ML model is available for the given tenant.
 * In production, this queries the model registry in DynamoDB.
 */
async function getModelConfig(_tenantId: string): Promise<ModelConfig> {
  // Simulated: model is available
  return {
    endpointName: "ollinai-prediction-endpoint",
    modelVersion: "1.0.0",
    available: true,
  };
}

// ─── Core Logic ────────────────────────────────────────────────────────────────

/**
 * Determine whether to use ML model or fall back to rule-based scoring.
 */
export function shouldUseMlModel(
  totalEvents: number,
  totalIncidents: number,
  modelAvailable: boolean
): boolean {
  if (!modelAvailable) return false;
  if (totalEvents < MIN_EVENTS_FOR_ML) return false;
  if (totalIncidents < MIN_INCIDENTS_FOR_ML) return false;
  return true;
}

/**
 * Run inference: either ML model or rule-based fallback.
 */
export async function runInference(
  request: InferenceRequest
): Promise<PredictionResult> {
  const startTime = Date.now();

  // Build feature vector
  const featureResult = constructFeatureVector(request.featureInput);
  if (!featureResult.valid || !featureResult.vector) {
    // On invalid features, return a neutral score via rule engine
    return {
      predictionScore: 0.5,
      modelVersion: "fallback",
      inferenceLatencyMs: Date.now() - startTime,
      source: "rule_engine",
    };
  }

  const vector = featureResult.vector;
  const modelConfig = await getModelConfig(request.tenantId);

  const useML = shouldUseMlModel(
    request.totalEvents,
    request.totalIncidents,
    modelConfig.available
  );

  if (useML) {
    const normalized = normalizeFeatureVector(vector);
    const result = await invokeSageMakerEndpoint(
      modelConfig.endpointName,
      normalized
    );

    if (result && result.latencyMs <= LATENCY_TARGET_MS) {
      return {
        predictionScore: result.score,
        modelVersion: modelConfig.modelVersion,
        inferenceLatencyMs: result.latencyMs,
        source: "ml_model",
      };
    }

    // Model call failed or too slow — fall back
  }

  // Rule-based fallback
  const score = ruleBasedScore(vector);
  return {
    predictionScore: score,
    modelVersion: "rule_engine_v1",
    inferenceLatencyMs: Date.now() - startTime,
    source: "rule_engine",
  };
}

// ─── Lambda Handler ────────────────────────────────────────────────────────────

export async function handler(event: SQSEvent): Promise<void> {
  for (const record of event.Records) {
    try {
      const request: InferenceRequest = JSON.parse(record.body);
      const result = await runInference(request);

      // In production: update DynamoDB event record with prediction score
      console.log(
        JSON.stringify({
          level: "info",
          message: "Inference complete",
          tenantId: request.tenantId,
          eventId: request.eventId,
          predictionScore: result.predictionScore,
          source: result.source,
          latencyMs: result.inferenceLatencyMs,
        })
      );
    } catch (error) {
      console.error("Inference failed for record:", error);
    }
  }
}
