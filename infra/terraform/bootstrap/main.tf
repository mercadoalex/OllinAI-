# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Bootstrap (State Backend)
#
# Creates the S3 bucket and DynamoDB table used by the main Terraform module
# as its remote state backend. This module uses LOCAL state (stored in this
# directory) since it can't use a backend that doesn't exist yet.
#
# Run ONCE before the main terraform:
#   cd infra/terraform/bootstrap
#   terraform init
#   terraform apply
#
# To destroy everything later:
#   1. cd infra/terraform && terraform destroy   (destroys app resources)
#   2. cd bootstrap && terraform destroy         (destroys state bucket + lock table)
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # LOCAL state — no remote backend for the bootstrap module
}

variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-2"
}

variable "project_name" {
  description = "Project name for resource naming"
  type        = string
  default     = "ollinai"
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project   = "OllinAI"
      ManagedBy = "Terraform-Bootstrap"
    }
  }
}

# ─── S3 Bucket for Terraform State ──────────────────────────────────────────

resource "aws_s3_bucket" "terraform_state" {
  bucket = "${var.project_name}-terraform-state"

  # Prevent accidental deletion
  lifecycle {
    prevent_destroy = false
  }
}

resource "aws_s3_bucket_versioning" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "terraform_state" {
  bucket = aws_s3_bucket.terraform_state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# ─── DynamoDB Table for State Locking ────────────────────────────────────────

resource "aws_dynamodb_table" "terraform_locks" {
  name         = "${var.project_name}-terraform-locks"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "LockID"

  attribute {
    name = "LockID"
    type = "S"
  }
}

# ─── Outputs ─────────────────────────────────────────────────────────────────

output "state_bucket_name" {
  description = "S3 bucket name for Terraform state"
  value       = aws_s3_bucket.terraform_state.id
}

output "state_bucket_arn" {
  description = "S3 bucket ARN"
  value       = aws_s3_bucket.terraform_state.arn
}

output "lock_table_name" {
  description = "DynamoDB table name for state locking"
  value       = aws_dynamodb_table.terraform_locks.name
}

output "next_steps" {
  description = "Instructions for using the main Terraform module"
  value       = <<-EOT
    
    ✅ Bootstrap complete! Now run the main Terraform:
    
      cd ../
      terraform init
      terraform plan
      terraform apply
    
    To destroy EVERYTHING later:
      1. cd infra/terraform && terraform destroy
      2. cd bootstrap && terraform destroy
    
  EOT
}
