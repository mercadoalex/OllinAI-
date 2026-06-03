# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — Terraform Root Module
# ─────────────────────────────────────────────────────────────────────────────

terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  backend "s3" {
    bucket         = "ollinai-terraform-state"
    key            = "production/terraform.tfstate"
    region         = "us-east-2"
    dynamodb_table = "ollinai-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "OllinAI"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
