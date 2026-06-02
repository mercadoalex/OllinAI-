/**
 * Predictive Intelligence API
 *
 * Returns incident predictions per deployment.
 * Implements anomaly detection (3σ deviation).
 * Correlates anomaly signals with deployments, generates early warnings.
 *
 * Requirements: 16.1, 16.2, 16.3, 16.4, 16.7
 */

import { NextRequest, NextResponse } from "next/server";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface PredictionRecord {
  eventId: string;
  serviceId: string;
  predictionScore: number;
  source: "ml_model" | "rule_engine";
  modelVersion: string;
  anomalyDetected: boolean;
  anomalyDetails?: AnomalyDetail[];
  earlyWarning: boolean;
  earlyWarningReason?: string;
  timestamp: string;
}

interface AnomalyDetail {
  type: "metric_deviation" | "behavioral" | "resource";
  description: string;
  deviation: number; // Number of standard deviations
  threshold: number;
}

interface RootCauseAnalysis {
  deploymentId: string;
  confidence: number;
  causalPattern: string;
}

// ─── Anomaly Detection Logic ──────────────────────────────────────────────────

/**
 * Detect 3σ anomalies in prediction scores.
 */
export function detectAnomalies(
  scores: number[],
  currentScore: number
): { isAnomaly: boolean; deviation: number; threshold: number } {
  if (scores.length < 10) {
    return { isAnomaly: false, deviation: 0, threshold: 3 };
  }

  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance =
    scores.reduce((sum, s) => sum + Math.pow(s - mean, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) {
    return { isAnomaly: currentScore !== mean, deviation: currentScore !== mean ? Infinity : 0, threshold: 3 };
  }

  const deviation = Math.abs(currentScore - mean) / stdDev;
  const threshold = 3; // 3σ

  return {
    isAnomaly: deviation > threshold,
    deviation,
    threshold,
  };
}

/**
 * Generate root cause analysis for predicted incidents.
 */
export function generateRootCauseRanking(
  predictions: Array<{ eventId: string; score: number; factors: string[] }>
): RootCauseAnalysis[] {
  return predictions
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((p, idx) => ({
      deploymentId: p.eventId,
      confidence: Math.max(0.1, p.score - idx * 0.1),
      causalPattern: p.factors.join(", ") || "unknown",
    }));
}

// ─── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/predictions — List predictions for deployments
 */
export async function GET(request: NextRequest) {
  const serviceId = request.nextUrl.searchParams.get("serviceId");
  const limit = Math.min(
    100,
    parseInt(request.nextUrl.searchParams.get("limit") || "25", 10)
  );

  // In production: query DynamoDB for prediction records
  const predictions: PredictionRecord[] = [
    {
      eventId: "example-event-1",
      serviceId: serviceId || "service-1",
      predictionScore: 0.72,
      source: "ml_model",
      modelVersion: "1.0.0",
      anomalyDetected: false,
      earlyWarning: false,
      timestamp: new Date().toISOString(),
    },
  ];

  return NextResponse.json({
    data: predictions.slice(0, limit),
    pagination: {
      totalCount: predictions.length,
      currentPage: 1,
      pageSize: limit,
      hasMore: predictions.length > limit,
    },
  });
}

/**
 * POST /api/predictions — Trigger prediction for a specific deployment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { eventId, serviceId } = body;

    if (!eventId || !serviceId) {
      return NextResponse.json(
        { error: "eventId and serviceId are required" },
        { status: 400 }
      );
    }

    // Simulated prediction with anomaly detection
    const historicalScores = [0.3, 0.35, 0.28, 0.32, 0.4, 0.38, 0.33, 0.35, 0.31, 0.37];
    const currentScore = 0.72; // Simulated

    const anomalyResult = detectAnomalies(historicalScores, currentScore);

    const prediction: PredictionRecord = {
      eventId,
      serviceId,
      predictionScore: currentScore,
      source: "ml_model",
      modelVersion: "1.0.0",
      anomalyDetected: anomalyResult.isAnomaly,
      anomalyDetails: anomalyResult.isAnomaly
        ? [
            {
              type: "metric_deviation",
              description: `Prediction score deviates ${anomalyResult.deviation.toFixed(1)}σ from mean`,
              deviation: anomalyResult.deviation,
              threshold: anomalyResult.threshold,
            },
          ]
        : undefined,
      earlyWarning: currentScore > 0.6,
      earlyWarningReason:
        currentScore > 0.6
          ? "High incident probability detected"
          : undefined,
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(prediction, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: "Invalid request body" },
      { status: 400 }
    );
  }
}
