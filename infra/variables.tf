variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Short name used as a prefix for all resources"
  type        = string
  default     = "webpilot"
}

variable "github_repo" {
  description = "GitHub repository in owner/name format — scopes the OIDC trust policy"
  type        = string
  # Example: "myorg/WebPilotv2"
}

variable "instance_type" {
  description = "EC2 instance type for the ECS host. t3.micro is free-tier eligible (750 h/month) and more widely available than t2.micro."
  type        = string
  default     = "t3.micro"
}

variable "server_port" {
  description = "Port the WebPilot container listens on"
  type        = number
  default     = 8000
}

variable "task_cpu" {
  description = "CPU units reserved for the ECS task (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "task_memory" {
  description = "Memory (MiB) reserved for the ECS task"
  type        = number
  default     = 512
}

variable "allowed_ingress_cidrs" {
  description = "CIDRs allowed to reach the server on port 8000 and SSH. Restrict in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
