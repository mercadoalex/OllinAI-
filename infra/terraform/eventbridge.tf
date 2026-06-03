# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — EventBridge
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_event_bus" "ollinai" {
  name = "${var.project_name}-events-bus"
}

# ─── Correlation → DORA Computer ────────────────────────────────────────────

resource "aws_cloudwatch_event_rule" "correlation_to_dora" {
  name           = "${var.project_name}-correlation-to-dora"
  description    = "Routes correlation.created events to DORA Computer"
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name

  event_pattern = jsonencode({
    source      = ["ollinai.correlator"]
    detail-type = ["correlation.created"]
  })
}

resource "aws_cloudwatch_event_target" "correlation_to_dora" {
  rule           = aws_cloudwatch_event_rule.correlation_to_dora.name
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name
  target_id      = "dora-computer-lambda"
  arn            = aws_lambda_function.dora_computer.arn
}

# ─── Correlation → Recommendation Engine ────────────────────────────────────

resource "aws_cloudwatch_event_rule" "correlation_to_recommendations" {
  name           = "${var.project_name}-correlation-to-recommendations"
  description    = "Routes correlation.created events to Recommendation Engine"
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name

  event_pattern = jsonencode({
    source      = ["ollinai.correlator"]
    detail-type = ["correlation.created"]
  })
}

resource "aws_cloudwatch_event_target" "correlation_to_recommendations" {
  rule           = aws_cloudwatch_event_rule.correlation_to_recommendations.name
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name
  target_id      = "recommendation-engine-lambda"
  arn            = aws_lambda_function.recommendation_engine.arn
}

# ─── Deployment Ingested → DORA Computer ────────────────────────────────────

resource "aws_cloudwatch_event_rule" "deployment_to_dora" {
  name           = "${var.project_name}-deployment-to-dora"
  description    = "Routes deployment.ingested events to DORA Computer"
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name

  event_pattern = jsonencode({
    source      = ["ollinai.ingestion"]
    detail-type = ["deployment.ingested"]
  })
}

resource "aws_cloudwatch_event_target" "deployment_to_dora" {
  rule           = aws_cloudwatch_event_rule.deployment_to_dora.name
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name
  target_id      = "dora-computer-lambda"
  arn            = aws_lambda_function.dora_computer.arn
}

# ─── High Risk → Recommendation Engine ──────────────────────────────────────

resource "aws_cloudwatch_event_rule" "high_risk_to_recommendations" {
  name           = "${var.project_name}-high-risk-to-recommendations"
  description    = "Routes high/critical risk scores to Recommendation Engine"
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name

  event_pattern = jsonencode({
    source      = ["ollinai.risk-scorer"]
    detail-type = ["risk-score.computed"]
    detail = {
      riskScore = ["high", "critical"]
    }
  })
}

resource "aws_cloudwatch_event_target" "high_risk_to_recommendations" {
  rule           = aws_cloudwatch_event_rule.high_risk_to_recommendations.name
  event_bus_name = aws_cloudwatch_event_bus.ollinai.name
  target_id      = "recommendation-engine-lambda"
  arn            = aws_lambda_function.recommendation_engine.arn
}

# ─── Retention Archiver Schedule (every 24 hours) ───────────────────────────

resource "aws_cloudwatch_event_rule" "retention_archiver_schedule" {
  name                = "${var.project_name}-retention-archiver"
  description         = "Triggers retention archiver every 24 hours"
  schedule_expression = "rate(24 hours)"
}

resource "aws_cloudwatch_event_target" "retention_archiver" {
  rule      = aws_cloudwatch_event_rule.retention_archiver_schedule.name
  target_id = "retention-archiver-lambda"
  arn       = aws_lambda_function.retention_archiver.arn
}
