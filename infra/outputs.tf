output "ecr_repository_url" {
  description = "Full ECR image URI (used to build and push images)"
  value       = aws_ecr_repository.app.repository_url
}

output "ecr_repository_name" {
  description = "→ Set as ECR_REPOSITORY in GitHub Actions vars"
  value       = aws_ecr_repository.app.name
}

output "aws_region" {
  description = "→ Set as AWS_REGION in GitHub Actions vars"
  value       = var.aws_region
}

output "ecs_cluster_name" {
  description = "→ Set as ECS_CLUSTER in GitHub Actions vars"
  value       = aws_ecs_cluster.main.name
}

output "ecs_service_name" {
  description = "→ Set as ECS_SERVICE in GitHub Actions vars"
  value       = aws_ecs_service.app.name
}

output "ecs_task_definition_family" {
  description = "→ Set as ECS_TASK_DEFINITION in GitHub Actions vars"
  value       = aws_ecs_task_definition.app.family
}

output "container_name" {
  description = "→ Set as CONTAINER_NAME in GitHub Actions vars"
  value       = local.container_name
}

output "github_actions_role_arn" {
  description = "→ Set as AWS_ROLE_TO_ASSUME secret in GitHub Actions"
  value       = aws_iam_role.github_actions.arn
}

output "server_access" {
  description = "How to reach the WebPilot server after deployment"
  value       = "EC2 console → Instances → ${local.prefix}-ecs-host → Public IPv4 → http://<ip>:${var.server_port}/health"
}
