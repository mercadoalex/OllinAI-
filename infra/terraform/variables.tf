# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Input Variables
# ─────────────────────────────────────────────────────────────────────────────

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-2"
}

variable "environment" {
  description = "Deployment environment (dev, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be one of: dev, staging, production."
  }
}

variable "project_name" {
  description = "Project name used for resource naming"
  type        = string
  default     = "ollinai"
}

# ─── DynamoDB ────────────────────────────────────────────────────────────────

variable "dynamodb_billing_mode" {
  description = "DynamoDB billing mode (PAY_PER_REQUEST or PROVISIONED)"
  type        = string
  default     = "PAY_PER_REQUEST"
}

variable "enable_dax" {
  description = "Enable DAX cluster for DynamoDB read acceleration"
  type        = bool
  default     = false
}

variable "dax_node_type" {
  description = "DAX cluster node type"
  type        = string
  default     = "dax.t3.small"
}

# ─── Lambda ──────────────────────────────────────────────────────────────────

variable "lambda_runtime" {
  description = "Lambda runtime for Node.js functions"
  type        = string
  default     = "nodejs20.x"
}

variable "lambda_memory_size" {
  description = "Default Lambda memory size in MB"
  type        = number
  default     = 256
}

variable "lambda_timeout" {
  description = "Default Lambda timeout in seconds"
  type        = number
  default     = 60
}

# ─── SageMaker ───────────────────────────────────────────────────────────────

variable "enable_sagemaker" {
  description = "Enable SageMaker resources (Phase 2)"
  type        = bool
  default     = false
}

variable "sagemaker_instance_type" {
  description = "SageMaker training instance type"
  type        = string
  default     = "ml.m5.large"
}

# ─── ECR ─────────────────────────────────────────────────────────────────────

variable "ecr_image_tag_mutability" {
  description = "Tag mutability for ECR repositories"
  type        = string
  default     = "IMMUTABLE"
}
