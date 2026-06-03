# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — SQS Queues
# ─────────────────────────────────────────────────────────────────────────────

# ─── Deployment Events Queue ─────────────────────────────────────────────────

resource "aws_sqs_queue" "deployment_events_dlq" {
  name                      = "${var.project_name}-deployment-events-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "deployment_events" {
  name                       = "${var.project_name}-deployment-events"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.deployment_events_dlq.arn
    maxReceiveCount     = 3
  })
}

# ─── Incidents Queue ─────────────────────────────────────────────────────────

resource "aws_sqs_queue" "incidents_dlq" {
  name                      = "${var.project_name}-incidents-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "incidents" {
  name                       = "${var.project_name}-incidents"
  visibility_timeout_seconds = 60
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.incidents_dlq.arn
    maxReceiveCount     = 3
  })
}

# ─── Agent Telemetry Queue ───────────────────────────────────────────────────

resource "aws_sqs_queue" "agent_telemetry_dlq" {
  name                      = "${var.project_name}-agent-telemetry-dlq"
  message_retention_seconds = 1209600
}

resource "aws_sqs_queue" "agent_telemetry" {
  name                       = "${var.project_name}-agent-telemetry"
  visibility_timeout_seconds = 120
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.agent_telemetry_dlq.arn
    maxReceiveCount     = 3
  })
}
