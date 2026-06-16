# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Lambda Functions
# ─────────────────────────────────────────────────────────────────────────────

# ─── IAM Role for Lambda ─────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_execution" {
  name = "${var.project_name}-lambda-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "lambda.amazonaws.com"
      }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  name = "${var.project_name}-lambda-dynamodb"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:DescribeStream",
        "dynamodb:GetRecords",
        "dynamodb:GetShardIterator",
        "dynamodb:ListStreams"
      ]
      Resource = [
        aws_dynamodb_table.events.arn,
        "${aws_dynamodb_table.events.arn}/index/*",
        "${aws_dynamodb_table.events.arn}/stream/*",
        aws_dynamodb_table.incidents.arn,
        "${aws_dynamodb_table.incidents.arn}/index/*",
        aws_dynamodb_table.metrics.arn,
        aws_dynamodb_table.config.arn,
        aws_dynamodb_table.audit.arn,
        aws_dynamodb_table.attestations.arn,
        aws_dynamodb_table.ml_models.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_sqs" {
  name = "${var.project_name}-lambda-sqs"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:GetQueueAttributes",
        "sqs:SendMessage"
      ]
      Resource = [
        aws_sqs_queue.deployment_events.arn,
        aws_sqs_queue.incidents.arn,
        aws_sqs_queue.agent_telemetry.arn,
      ]
    }]
  })
}

resource "aws_iam_role_policy" "lambda_eventbridge" {
  name = "${var.project_name}-lambda-eventbridge"
  role = aws_iam_role.lambda_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["events:PutEvents"]
      Resource = [aws_cloudwatch_event_bus.ollinai.arn]
    }]
  })
}

# ─── Correlator Lambda ───────────────────────────────────────────────────────

resource "aws_lambda_function" "correlator" {
  function_name = "${var.project_name}-correlator"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = var.lambda_runtime
  handler       = "handler.handler"
  memory_size   = var.lambda_memory_size
  timeout       = var.lambda_timeout

  filename = "${path.module}/placeholder.zip" # Replaced by CI/CD

  environment {
    variables = {
      EVENT_BUS_NAME = aws_cloudwatch_event_bus.ollinai.name
    }
  }
}

resource "aws_lambda_event_source_mapping" "correlator_sqs" {
  event_source_arn                   = aws_sqs_queue.incidents.arn
  function_name                      = aws_lambda_function.correlator.arn
  batch_size                         = 10
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 5
}

# ─── Risk Scorer Lambda ──────────────────────────────────────────────────────

resource "aws_lambda_function" "risk_scorer" {
  function_name = "${var.project_name}-risk-scorer"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = var.lambda_runtime
  handler       = "handler.handler"
  memory_size   = var.lambda_memory_size
  timeout       = var.lambda_timeout

  filename = "${path.module}/placeholder.zip"

  environment {
    variables = {
      EVENT_BUS_NAME = aws_cloudwatch_event_bus.ollinai.name
    }
  }
}

resource "aws_lambda_event_source_mapping" "risk_scorer_sqs" {
  event_source_arn                   = aws_sqs_queue.deployment_events.arn
  function_name                      = aws_lambda_function.risk_scorer.arn
  batch_size                         = 10
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 5
}

# DynamoDB Streams trigger provides a more native DynamoDB pattern where the table
# mutation IS the event source, eliminating the need for a separate SQS queue.
# Disabled by default; can be enabled as an alternative to the SQS trigger above.
resource "aws_lambda_event_source_mapping" "risk_scorer_stream" {
  event_source_arn  = aws_dynamodb_table.events.stream_arn
  function_name     = aws_lambda_function.risk_scorer.arn
  starting_position = "LATEST"
  batch_size        = 10
  enabled           = false
}

# ─── DORA Computer Lambda ────────────────────────────────────────────────────

resource "aws_lambda_function" "dora_computer" {
  function_name = "${var.project_name}-dora-computer"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = var.lambda_runtime
  handler       = "handler.handler"
  memory_size   = var.lambda_memory_size
  timeout       = var.lambda_timeout

  filename = "${path.module}/placeholder.zip"
}

resource "aws_lambda_permission" "dora_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.dora_computer.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.correlation_to_dora.arn
}

# ─── Recommendation Engine Lambda ───────────────────────────────────────────

resource "aws_lambda_function" "recommendation_engine" {
  function_name = "${var.project_name}-recommendation-engine"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = var.lambda_runtime
  handler       = "handler.handler"
  memory_size   = var.lambda_memory_size
  timeout       = var.lambda_timeout

  filename = "${path.module}/placeholder.zip"
}

resource "aws_lambda_permission" "recommendations_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.recommendation_engine.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.correlation_to_recommendations.arn
}

# ─── Telemetry Processor Lambda ──────────────────────────────────────────────

resource "aws_lambda_function" "telemetry_processor" {
  function_name = "${var.project_name}-telemetry-processor"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = var.lambda_runtime
  handler       = "handler.handler"
  memory_size   = 512
  timeout       = 120

  filename = "${path.module}/placeholder.zip"
}

resource "aws_lambda_event_source_mapping" "telemetry_processor_sqs" {
  event_source_arn                   = aws_sqs_queue.agent_telemetry.arn
  function_name                      = aws_lambda_function.telemetry_processor.arn
  batch_size                         = 10
  function_response_types            = ["ReportBatchItemFailures"]
  maximum_batching_window_in_seconds = 10
}

# ─── Retention Archiver Lambda ───────────────────────────────────────────────

resource "aws_lambda_function" "retention_archiver" {
  function_name = "${var.project_name}-retention-archiver"
  role          = aws_iam_role.lambda_execution.arn
  runtime       = var.lambda_runtime
  handler       = "handler.handler"
  memory_size   = 512
  timeout       = 900 # 15 minutes max for archival

  filename = "${path.module}/placeholder.zip"
}

resource "aws_lambda_permission" "retention_archiver_schedule" {
  statement_id  = "AllowScheduleInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.retention_archiver.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.retention_archiver_schedule.arn
}
