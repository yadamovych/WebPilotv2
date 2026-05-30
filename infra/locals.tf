locals {
  prefix         = var.project_name
  container_name = "${var.project_name}-server"

  # Maps SSM parameter key → container environment variable name.
  # Add entries here to expose more secrets to the container.
  api_key_params = {
    openai_api_key    = "OPENAI_API_KEY"
    groq_api_key      = "GROQ_API_KEY"
    anthropic_api_key = "ANTHROPIC_API_KEY"
  }
}
