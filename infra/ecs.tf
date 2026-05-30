# ---------------------------------------------------------------------------
# CloudWatch Log Group — 5 GB/month free
# ---------------------------------------------------------------------------
resource "aws_cloudwatch_log_group" "ecs" {
  name              = "/ecs/${local.prefix}"
  retention_in_days = 7

  tags = { Name = "${local.prefix}-logs" }
}

# ---------------------------------------------------------------------------
# ECS Cluster
# ---------------------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = "${local.prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "disabled" # Enable if you want per-container metrics (adds CloudWatch cost)
  }

  tags = { Name = "${local.prefix}-cluster" }
}

# ---------------------------------------------------------------------------
# ECS Task Definition
# The initial image points at ECR :latest.
# The CD pipeline registers a new revision on every deploy.
# ---------------------------------------------------------------------------
resource "aws_ecs_task_definition" "app" {
  family                   = "${local.prefix}-task"
  requires_compatibilities = ["EC2"]
  network_mode             = "bridge"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn

  container_definitions = jsonencode([{
    name  = local.container_name
    image = "${aws_ecr_repository.app.repository_url}:latest"

    portMappings = [{
      containerPort = var.server_port
      hostPort      = var.server_port
      protocol      = "tcp"
    }]

    # Inject API keys from SSM at container startup (never stored in task def plaintext)
    secrets = [
      for param_key, env_name in local.api_key_params : {
        name      = env_name
        valueFrom = aws_ssm_parameter.api_keys[param_key].arn
      }
    ]

    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.ecs.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "ecs"
      }
    }

    essential = true
  }])

  tags = { Name = "${local.prefix}-task" }
}

# ---------------------------------------------------------------------------
# EC2 host — ECS-optimized Amazon Linux 2, t2.micro (free tier: 750 h/month)
# ---------------------------------------------------------------------------
data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2/recommended/image_id"
}

resource "aws_launch_template" "ecs_host" {
  name_prefix   = "${local.prefix}-ecs-host-"
  image_id      = data.aws_ssm_parameter.ecs_ami.value
  instance_type = var.instance_type

  iam_instance_profile {
    name = aws_iam_instance_profile.ecs_instance.name
  }

  network_interfaces {
    associate_public_ip_address = true
    security_groups             = [aws_security_group.ecs_host.id]
  }

  # Register this instance with the ECS cluster on first boot
  user_data = base64encode(<<-EOF
    #!/bin/bash
    # Register with ECS cluster
    echo ECS_CLUSTER=${aws_ecs_cluster.main.name}       >> /etc/ecs/ecs.config
    echo ECS_ENABLE_CONTAINER_METADATA=true             >> /etc/ecs/ecs.config

    %{if var.duckdns_token != "" && var.duckdns_subdomain != ""~}
    # Update DuckDNS with current public IP on every boot
    curl -fsSL \
      "https://www.duckdns.org/update?domains=${var.duckdns_subdomain}&token=${var.duckdns_token}&ip=" \
      -o /var/log/duckdns.log

    # Re-run on every reboot via cron
    echo "@reboot root curl -fsSL 'https://www.duckdns.org/update?domains=${var.duckdns_subdomain}&token=${var.duckdns_token}&ip=' -o /var/log/duckdns.log" \
      > /etc/cron.d/duckdns
    %{endif~}
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name    = "${local.prefix}-ecs-host"
      Project = var.project_name
    }
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_autoscaling_group" "ecs_host" {
  name                = "${local.prefix}-ecs-asg"
  desired_capacity    = 1
  min_size            = 1
  max_size            = 1
  vpc_zone_identifier = [aws_subnet.public.id, aws_subnet.public_b.id]

  launch_template {
    id      = aws_launch_template.ecs_host.id
    version = "$Latest"
  }

  # Required tag for the ECS agent to associate this instance with the cluster
  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }

  lifecycle {
    create_before_destroy = true
  }
}

# ---------------------------------------------------------------------------
# ECS Service — rolling update on a single instance
# min_healthy = 0 % allows ECS to stop the old task before starting the new one
# (necessary when there is only one EC2 host and one task slot)
# ---------------------------------------------------------------------------
resource "aws_ecs_service" "app" {
  name            = "${local.prefix}-service"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.app.arn
  desired_count   = 1
  launch_type     = "EC2"

  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  depends_on = [aws_autoscaling_group.ecs_host]

  lifecycle {
    # Let the CD pipeline manage task_definition revisions
    ignore_changes = [task_definition]
  }

  tags = { Name = "${local.prefix}-service" }
}
