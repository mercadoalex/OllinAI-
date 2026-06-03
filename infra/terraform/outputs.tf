# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Outputs
# ─────────────────────────────────────────────────────────────────────────────

# ─── DynamoDB ────────────────────────────────────────────────────────────────

output "dynamodb_events_table_arn" {
  description = "ARN of the ollinai-events DynamoDB table"
  value       = aws_dynamodb_table.events.arn
}

output "dynamodb_incidents_table_arn" {
  description = "ARN of the ollinai-incidents DynamoDB table"
  value       = aws_dynamodb_table.incidents.arn
}

output "dynamodb_metrics_table_arn" {
  description = "ARN of the ollinai-metrics DynamoDB table"
  value       = aws_dynamodb_table.metrics.arn
}

output "dynamodb_config_table_arn" {
  description = "ARN of the ollinai-config DynamoDB table"
  value       = aws_dynamodb_table.config.arn
}

output "dynamodb_audit_table_arn" {
  description = "ARN of the ollinai-audit DynamoDB table"
  value       = aws_dynamodb_table.audit.arn
}

# ─── SQS ─────────────────────────────────────────────────────────────────────

output "sqs_deployment_events_url" {
  description = "URL of the deployment events SQS queue"
  value       = aws_sqs_queue.deployment_events.url
}

output "sqs_incidents_url" {
  description = "URL of the incidents SQS queue"
  value       = aws_sqs_queue.incidents.url
}

output "sqs_agent_telemetry_url" {
  description = "URL of the agent telemetry SQS queue"
  value       = aws_sqs_queue.agent_telemetry.url
}

# ─── EventBridge ─────────────────────────────────────────────────────────────

output "eventbridge_bus_arn" {
  description = "ARN of the OllinAI EventBridge bus"
  value       = aws_cloudwatch_event_bus.ollinai.arn
}

# ─── Lambda ──────────────────────────────────────────────────────────────────

output "lambda_correlator_arn" {
  description = "ARN of the correlator Lambda function"
  value       = aws_lambda_function.correlator.arn
}

output "lambda_risk_scorer_arn" {
  description = "ARN of the risk scorer Lambda function"
  value       = aws_lambda_function.risk_scorer.arn
}

# ─── ECR ─────────────────────────────────────────────────────────────────────

output "ecr_agent_repository_url" {
  description = "URL of the OllinAI Agent ECR repository"
  value       = aws_ecr_repository.agent.repository_url
}

output "ecr_rules_repository_url" {
  description = "URL of the Rule_Bundle ECR repository"
  value       = aws_ecr_repository.rules.repository_url
}
