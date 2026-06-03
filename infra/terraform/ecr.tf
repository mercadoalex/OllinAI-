# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — ECR Repositories
# ─────────────────────────────────────────────────────────────────────────────

# ─── Agent Container Image ───────────────────────────────────────────────────

resource "aws_ecr_repository" "agent" {
  name                 = "${var.project_name}-agent"
  image_tag_mutability = var.ecr_image_tag_mutability

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "agent" {
  repository = aws_ecr_repository.agent.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 10
      }
      action = {
        type = "expire"
      }
    }]
  })
}

# ─── Rule Bundles OCI Registry ───────────────────────────────────────────────

resource "aws_ecr_repository" "rules" {
  name                 = "${var.project_name}-rules"
  image_tag_mutability = var.ecr_image_tag_mutability

  image_scanning_configuration {
    scan_on_push = false
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "rules" {
  repository = aws_ecr_repository.rules.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 rule bundles per tag prefix"
      selection = {
        tagStatus     = "tagged"
        tagPrefixList = ["v"]
        countType     = "imageCountMoreThan"
        countNumber   = 5
      }
      action = {
        type = "expire"
      }
    }]
  })
}
