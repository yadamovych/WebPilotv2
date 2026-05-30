# ---------------------------------------------------------------------------
# SSM Parameter Store — standard tier SecureString is free
# Values are initialised to "REPLACE_ME". Set real values via:
#   aws ssm put-parameter --name "/webpilot/openai_api_key" \
#     --value "sk-..." --type SecureString --overwrite
# ---------------------------------------------------------------------------
resource "aws_ssm_parameter" "api_keys" {
  for_each = local.api_key_params

  name        = "/${local.prefix}/${each.key}"
  description = "WebPilot ${each.value} — replace placeholder with a real key"
  type        = "SecureString"
  value       = "REPLACE_ME"

  lifecycle {
    # Prevent Terraform from overwriting values updated outside of Terraform
    ignore_changes = [value]
  }

  tags = { Name = "${local.prefix}-${each.key}" }
}
