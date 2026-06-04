/**
 * Prediction logic — extracted for testability.
 */

interface RootCauseAnalysis {
  deploymentId: string;
  confidence: number;
  causalPattern: string;
}

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
  const threshold = 3;

  return {
    isAnomaly: deviation > threshold,
    deviation,
    threshold,
  };
}

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
