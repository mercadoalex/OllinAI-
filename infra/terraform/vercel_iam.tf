# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — IAM User for Vercel (DynamoDB + SQS Access)
#
# This user provides the credentials that Vercel serverless functions use
# to access AWS services. Managed by Terraform so `terraform destroy`
# cleans everything up.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_iam_user" "vercel" {
  name = "${var.project_name}-vercel"
  path = "/service-accounts/"

  tags = {
    Purpose = "Vercel serverless functions access to DynamoDB and SQS"
  }
}

resource "aws_iam_access_key" "vercel" {
  user = aws_iam_user.vercel.name
}

# ─── DynamoDB Policy ─────────────────────────────────────────────────────────

resource "aws_iam_user_policy" "vercel_dynamodb" {
  name = "${var.project_name}-vercel-dynamodb"
  user = aws_iam_user.vercel.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "DynamoDBFullAccess"
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchGetItem",
        "dynamodb:BatchWriteItem",
        "dynamodb:ConditionCheckItem"
      ]
      Resource = [
        aws_dynamodb_table.events.arn,
        "${aws_dynamodb_table.events.arn}/index/*",
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

# ─── SQS Policy ─────────────────────────────────────────────────────────────

resource "aws_iam_user_policy" "vercel_sqs" {
  name = "${var.project_name}-vercel-sqs"
  user = aws_iam_user.vercel.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "SQSSendMessage"
      Effect = "Allow"
      Action = [
        "sqs:SendMessage",
        "sqs:GetQueueUrl",
        "sqs:GetQueueAttributes"
      ]
      Resource = [
        aws_sqs_queue.deployment_events.arn,
        aws_sqs_queue.incidents.arn,
        aws_sqs_queue.agent_telemetry.arn,
      ]
    }]
  })
}

# ─── Outputs (credentials for Vercel env vars) ──────────────────────────────

output "vercel_iam_access_key_id" {
  description = "Access Key ID for Vercel — set as AWS_ACCESS_KEY_ID in Vercel env vars"
  value       = aws_iam_access_key.vercel.id
}

output "vercel_iam_secret_access_key" {
  description = "Secret Access Key for Vercel — set as AWS_SECRET_ACCESS_KEY in Vercel env vars"
  value       = aws_iam_access_key.vercel.secret
  sensitive   = true
}
