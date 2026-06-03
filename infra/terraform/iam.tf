# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — IAM Roles (Data Residency Cross-Account)
# ─────────────────────────────────────────────────────────────────────────────

# ─── Data Residency Processor Role ──────────────────────────────────────────
# This role is assumed by the residency-processor Lambda to read from
# tenant S3 buckets in other AWS accounts.

resource "aws_iam_role" "residency_processor" {
  name = "${var.project_name}-residency-processor"

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

resource "aws_iam_role_policy" "residency_processor_sts" {
  name = "${var.project_name}-residency-sts"
  role = aws_iam_role.residency_processor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sts:AssumeRole"]
      Resource = ["arn:aws:iam::*:role/ollinai-data-residency-*"]
      Condition = {
        StringEquals = {
          "sts:ExternalId" = "ollinai-residency"
        }
      }
    }]
  })
}
