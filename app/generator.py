"""Deterministic Nuon config generator from Helm chart metadata."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.github import ChartInfo

# ---------------------------------------------------------------------------
# Infrastructure dependency mapping
# ---------------------------------------------------------------------------

KNOWN_INFRA_DEPS: dict[str, dict] = {
    "postgresql": {"component": "rds", "engine": "postgres", "label": "PostgreSQL (RDS)"},
    "mysql":      {"component": "rds", "engine": "mysql",    "label": "MySQL (RDS)"},
    "mariadb":    {"component": "rds", "engine": "mysql",    "label": "MariaDB (RDS)"},
    "redis":      {"component": "elasticache", "engine": "redis", "label": "Redis (ElastiCache)"},
    "memcached":  {"component": "elasticache", "engine": "memcached", "label": "Memcached (ElastiCache)"},
    "minio":      {"component": "s3", "engine": None, "label": "S3-compatible Storage"},
}

# Common password keys in Helm values.yaml that should be wired to inputs
_PASSWORD_PATTERNS = re.compile(
    r"^(\s*)(password|adminPassword|admin-password|auth\.password|"
    r"postgresqlPassword|postgresPassword|rootPassword|"
    r"auth\.postgresPassword|auth\.adminPassword|"
    r"repmgrPassword|srCheckPassword|"
    r"mariadbPassword|mysqlPassword|redisPassword):\s*(.+)$",
    re.MULTILINE,
)


@dataclass
class GeneratedFile:
    filename: str
    language: str
    content: str


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------

def detect_infra_deps(chart_dependencies: list[dict]) -> list[str]:
    """Return infra dep keys auto-detected from Chart.yaml dependencies."""
    detected: list[str] = []
    for dep in chart_dependencies:
        name = dep.get("name", "").lower()
        if name in KNOWN_INFRA_DEPS and name not in detected:
            detected.append(name)
    return detected


# ---------------------------------------------------------------------------
# Template helpers
# ---------------------------------------------------------------------------

def _esc(value: str) -> str:
    """Escape a string for safe inclusion in TOML quoted values."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def _rewrite_passwords(values: str) -> str:
    """Replace hardcoded password values with Nuon input template variable."""
    def _replace(m: re.Match) -> str:
        indent = m.group(1)
        key = m.group(2)
        return f'{indent}{key}: "{{{{ .nuon.inputs.inputs.admin_password }}}}"'
    return _PASSWORD_PATTERNS.sub(_replace, values)


def _strip_conflicting_keys(values: str, keys_to_strip: list[str]) -> str:
    """Remove top-level YAML keys (and their nested content) that conflict with scaffold wiring.

    Strips a top-level key and all indented lines below it until the next
    top-level key or end of file. Inserts a comment noting the removal.
    """
    lines = values.split("\n")
    result: list[str] = []
    skipping = False
    skipped_key = ""

    for line in lines:
        stripped = line.strip()
        # Check if this is a top-level key (not indented, not a comment, not blank)
        if stripped and not stripped.startswith("#") and not line.startswith((" ", "\t")):
            key_name = stripped.split(":")[0].strip() if ":" in stripped else ""
            if key_name in keys_to_strip:
                skipping = True
                skipped_key = key_name
                result.append(f"# [{skipped_key}: overridden by Nuon wiring above]")
                continue
            else:
                skipping = False

        if skipping:
            # Skip indented lines under the removed key
            if not stripped or line.startswith((" ", "\t")) or stripped.startswith("#"):
                continue
            else:
                skipping = False

        result.append(line)

    return "\n".join(result)


# ---------------------------------------------------------------------------
# Individual file generators
# ---------------------------------------------------------------------------

def _generate_metadata(chart_name: str, description: str) -> GeneratedFile:
    desc = description or f"Nuon BYOC config for {chart_name}"
    content = f"""\
# metadata
version      = "v2"
description  = "{_esc(desc)}"
display_name = "{_esc(chart_name)}\""""
    return GeneratedFile("metadata.toml", "toml", content)


def _generate_sandbox(cloud_provider: str) -> GeneratedFile:
    if cloud_provider == "azure":
        content = (
            '# sandbox\n'
            'name              = "aks"\n'
            'terraform_version = "1.11.3"\n'
            '\n'
            '[public_repo]\n'
            'repo      = "nuonco/azure-aks-sandbox"\n'
            'branch    = "main"\n'
            'directory = "."'
        )
    else:
        content = (
            '# sandbox\n'
            'name              = "eks"\n'
            'terraform_version = "1.11.3"\n'
            '\n'
            '[public_repo]\n'
            'repo      = "nuonco/aws-eks-sandbox"\n'
            'branch    = "main"\n'
            'directory = "."'
        )
    return GeneratedFile("sandbox.toml", "toml", content)


def _generate_runner(cloud_provider: str) -> GeneratedFile:
    runner = "azure" if cloud_provider == "azure" else "aws"
    content = f"""\
# runner
runner_type = "{runner}\""""
    return GeneratedFile("runner.toml", "toml", content)


def _generate_inputs(chart_name: str, infra_deps: list[str]) -> GeneratedFile:
    lines = [
        "# inputs",
        "",
        "# --- Groups ---",
        "",
        "[[group]]",
        'name         = "application"',
        'description  = "Core application settings"',
        'display_name = "Application"',
        "",
        "[[group]]",
        'name         = "networking"',
        'description  = "Domain and ingress settings"',
        'display_name = "Networking"',
        "",
        "# --- Inputs ---",
        "",
        "[[input]]",
        'name         = "subdomain"',
        f'description  = "Subdomain for {_esc(chart_name)} (e.g. \'app\' for app.customer.nuon.run)"',
        f'default      = "{_esc(chart_name)}"',
        'display_name = "Subdomain"',
        'group        = "networking"',
        "",
        "[[input]]",
        'name         = "admin_password"',
        f'description  = "Initial admin password for {_esc(chart_name)}"',
        'default      = ""',
        'display_name = "Admin Password"',
        'group        = "application"',
        "sensitive    = true",
        "required     = true",
    ]

    has_db = any(d in infra_deps for d in ("postgresql", "mysql", "mariadb"))
    if has_db:
        db_default = chart_name.replace("-", "_")
        lines.extend([
            "",
            "[[group]]",
            'name         = "database"',
            'description  = "Database configuration"',
            'display_name = "Database"',
            "",
            "[[input]]",
            'name         = "db_name"',
            f'description  = "Database name for {_esc(chart_name)}"',
            f'default      = "{_esc(db_default)}"',
            'display_name = "Database Name"',
            'group        = "database"',
        ])

    return GeneratedFile("inputs.toml", "toml", "\n".join(lines))


def _generate_database_component(engine: str, chart_name: str, number: int, config_repo: str = "") -> list[GeneratedFile]:
    engine_label = "PostgreSQL" if engine == "postgres" else "MySQL"
    tf_dir = f"components/{number}-rds"
    db_engine = "postgres" if engine == "postgres" else "mysql"
    db_port = "5432" if engine == "postgres" else "3306"

    repo = config_repo or "YOUR_ORG/YOUR_REPO"
    todo = "" if config_repo else (
        "\n#\n"
        "# TODO: After pushing this config to your GitHub repo, update [public_repo]\n"
        f"#       to point to your repo. The Terraform code is in {tf_dir}/"
    )
    toml_content = f"""\
# terraform
name              = "rds"
type              = "terraform_module"
terraform_version = "1.11.3"
# Provisions an RDS {engine_label} instance for {chart_name}{todo}

[public_repo]
repo      = "{_esc(repo)}"
directory = "{tf_dir}"
branch    = "main"

[vars]
region                 = "{{{{ .nuon.install_stack.outputs.region }}}}"
install_id             = "{{{{ .nuon.install.id }}}}"
vpc_id                 = "{{{{ .nuon.install.sandbox.outputs.vpc.id }}}}"
private_subnet_ids     = "{{{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 0 }}}},{{{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 1 }}}},{{{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 2 }}}}"
node_security_group_id = "{{{{ .nuon.install.sandbox.outputs.cluster.node_security_group_id }}}}"
db_name                = "{{{{ .nuon.inputs.inputs.db_name }}}}"
instance_class         = "db.t3.medium\""""

    tf_content = f"""\
variable "region" {{
  type = string
}}

variable "install_id" {{
  type = string
}}

variable "vpc_id" {{
  type = string
}}

variable "private_subnet_ids" {{
  type = string
}}

variable "node_security_group_id" {{
  type = string
}}

variable "db_name" {{
  type    = string
  default = "{chart_name.replace("-", "_")}"
}}

variable "instance_class" {{
  type    = string
  default = "db.t3.medium"
}}

locals {{
  subnet_ids = split(",", var.private_subnet_ids)
}}

resource "aws_db_subnet_group" "this" {{
  name       = "${{var.install_id}}-{chart_name}"
  subnet_ids = local.subnet_ids

  tags = {{
    Name      = "${{var.install_id}}-{chart_name}"
    ManagedBy = "nuon"
  }}
}}

resource "aws_security_group" "rds" {{
  name_prefix = "${{var.install_id}}-{chart_name}-rds-"
  vpc_id      = var.vpc_id

  ingress {{
    from_port       = {db_port}
    to_port         = {db_port}
    protocol        = "tcp"
    security_groups = [var.node_security_group_id]
  }}

  egress {{
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}

  tags = {{
    Name      = "${{var.install_id}}-{chart_name}-rds"
    ManagedBy = "nuon"
  }}
}}

resource "aws_db_instance" "this" {{
  identifier     = "${{var.install_id}}-{chart_name}"
  engine         = "{db_engine}"
  engine_version = "{("15.4" if engine == "postgres" else "8.0")}"
  instance_class = var.instance_class

  db_name  = var.db_name
  username = "admin"
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = false
  skip_final_snapshot = true
  deletion_protection = false

  tags = {{
    Name      = "${{var.install_id}}-{chart_name}"
    ManagedBy = "nuon"
  }}
}}

output "address" {{
  value = aws_db_instance.this.address
}}

output "db_instance_port" {{
  value = tostring(aws_db_instance.this.port)
}}

output "db_instance_master_user_secret_arn" {{
  value = aws_db_instance.this.master_user_secret[0].secret_arn
}}"""

    return [
        GeneratedFile(f"components/{number}-rds.toml", "toml", toml_content),
        GeneratedFile(f"{tf_dir}/main.tf", "hcl", tf_content),
    ]


def _generate_elasticache_component(engine: str, number: int, config_repo: str = "") -> list[GeneratedFile]:
    tf_dir = f"components/{number}-elasticache"
    repo = config_repo or "YOUR_ORG/YOUR_REPO"
    todo = "" if config_repo else (
        "\n#\n"
        "# TODO: After pushing this config to your GitHub repo, update [public_repo]\n"
        f"#       to point to your repo. The Terraform code is in {tf_dir}/"
    )

    toml_content = f"""\
# terraform
name              = "elasticache"
type              = "terraform_module"
terraform_version = "1.11.3"{todo}

[public_repo]
repo      = "{_esc(repo)}"
directory = "{tf_dir}"
branch    = "main"

[vars]
region                 = "{{{{ .nuon.install_stack.outputs.region }}}}"
install_id             = "{{{{ .nuon.install.id }}}}"
vpc_id                 = "{{{{ .nuon.install.sandbox.outputs.vpc.id }}}}"
private_subnet_ids     = "{{{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 0 }}}},{{{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 1 }}}},{{{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 2 }}}}"
node_security_group_id = "{{{{ .nuon.install.sandbox.outputs.cluster.node_security_group_id }}}}"
node_type              = "cache.t3.small"
engine_version         = "7.0\""""

    tf_content = f"""\
variable "region" {{ type = string }}
variable "install_id" {{ type = string }}
variable "vpc_id" {{ type = string }}
variable "private_subnet_ids" {{ type = string }}
variable "node_security_group_id" {{ type = string }}
variable "node_type" {{ type = string; default = "cache.t3.small" }}
variable "engine_version" {{ type = string; default = "7.0" }}

locals {{
  subnet_ids = split(",", var.private_subnet_ids)
}}

resource "aws_elasticache_subnet_group" "this" {{
  name       = "${{var.install_id}}-cache"
  subnet_ids = local.subnet_ids
}}

resource "aws_security_group" "cache" {{
  name_prefix = "${{var.install_id}}-cache-"
  vpc_id      = var.vpc_id

  ingress {{
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.node_security_group_id]
  }}

  egress {{
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }}
}}

resource "aws_elasticache_cluster" "this" {{
  cluster_id           = "${{var.install_id}}-cache"
  engine               = "{engine}"
  engine_version       = var.engine_version
  node_type            = var.node_type
  num_cache_nodes      = 1
  subnet_group_name    = aws_elasticache_subnet_group.this.name
  security_group_ids   = [aws_security_group.cache.id]
}}

output "endpoint" {{
  value = aws_elasticache_cluster.this.cache_nodes[0].address
}}"""

    return [
        GeneratedFile(f"components/{number}-elasticache.toml", "toml", toml_content),
        GeneratedFile(f"{tf_dir}/main.tf", "hcl", tf_content),
    ]


def _generate_s3_component(chart_name: str, number: int, config_repo: str = "") -> list[GeneratedFile]:
    tf_dir = f"components/{number}-s3"
    repo = config_repo or "YOUR_ORG/YOUR_REPO"
    todo = "" if config_repo else (
        "\n#\n"
        "# TODO: After pushing this config to your GitHub repo, update [public_repo]\n"
        f"#       to point to your repo. The Terraform code is in {tf_dir}/"
    )

    toml_content = f"""\
# terraform
name              = "s3"
type              = "terraform_module"
terraform_version = "1.11.3"{todo}

[public_repo]
repo      = "{_esc(repo)}"
directory = "{tf_dir}"
branch    = "main"

[vars]
region     = "{{{{ .nuon.install_stack.outputs.region }}}}"
install_id = "{{{{ .nuon.install.id }}}}"
prefix     = "{_esc(chart_name)}\""""

    tf_content = f"""\
variable "region" {{ type = string }}
variable "install_id" {{ type = string }}
variable "prefix" {{ type = string; default = "{_esc(chart_name)}" }}

resource "aws_s3_bucket" "this" {{
  bucket = "${{var.install_id}}-${{var.prefix}}"

  tags = {{
    Name      = "${{var.install_id}}-${{var.prefix}}"
    ManagedBy = "nuon"
  }}
}}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {{
  bucket = aws_s3_bucket.this.id
  rule {{
    apply_server_side_encryption_by_default {{
      sse_algorithm = "aws:kms"
    }}
  }}
}}

output "bucket_name" {{
  value = aws_s3_bucket.this.id
}}

output "bucket_arn" {{
  value = aws_s3_bucket.this.arn
}}"""

    return [
        GeneratedFile(f"components/{number}-s3.toml", "toml", toml_content),
        GeneratedFile(f"{tf_dir}/main.tf", "hcl", tf_content),
    ]


def _generate_app_component(
    chart_name: str,
    org: str,
    repo: str,
    branch: str,
    directory: str,
    namespace: str,
    dep_component_names: list[str],
    component_number: int,
    helm_repo_url: str = "",
) -> GeneratedFile:
    if dep_component_names:
        dep_str = ", ".join(f'"{d}"' for d in dep_component_names)
        dep_line = f"dependencies   = [{dep_str}]"
    else:
        dep_line = "# dependencies = []"

    # Use [helm_repo] for registry-based charts, [public_repo] for GitHub
    if helm_repo_url:
        source_block = f"""\
[helm_repo]
repo_url = "{_esc(helm_repo_url)}"
chart    = "{_esc(chart_name)}\""""
    else:
        source_block = f"""\
[public_repo]
repo      = "{_esc(org)}/{_esc(repo)}"
directory = "{_esc(directory)}"
branch    = "{_esc(branch)}\""""

    content = f"""\
# helm
name           = "{_esc(chart_name)}"
type           = "helm_chart"
chart_name     = "{_esc(chart_name)}"
namespace      = "{_esc(namespace)}"
storage_driver = "configmap"
{dep_line}

{source_block}

[[values_file]]
contents = "./values/{_esc(chart_name)}/values.yaml\""""
    filename = f"components/{component_number}-{chart_name}.toml"
    return GeneratedFile(filename, "toml", content)


def _generate_db_credentials_action(chart_name: str, namespace: str) -> GeneratedFile:
    content = f"""\
# action
name    = "create_db_secret"
timeout = "2m"

[[triggers]]
type           = "post-deploy-component"
component_name = "rds"

[[triggers]]
type = "manual"

[[steps]]
name    = "Copy RDS credentials to Kubernetes secret"
command = "./import.sh"

[steps.public_repo]
repo      = "nuonco/example-app-configs"
directory = "shared/actions/rds-secrets"
branch    = "main"

[steps.env_vars]
SECRET_ARN       = "{{{{ .nuon.components.rds.outputs.db_instance_master_user_secret_arn }}}}"
REGION           = "{{{{ .nuon.install_stack.outputs.region }}}}"
TARGET_NAME      = "{_esc(chart_name)}-db-credentials"
TARGET_NAMESPACE = "{_esc(namespace)}\""""
    return GeneratedFile("actions/db-credentials.toml", "toml", content)


def _generate_values_file(
    chart_name: str,
    original_values: str | None,
    infra_deps: list[str],
) -> GeneratedFile:
    sections: list[str] = []

    sections.append(f"""\
# =============================================================================
# Nuon-templated values for {chart_name}
# =============================================================================
#
# TODO: Review the sections below. Wire Nuon template variables to the
#       Helm values that should be configurable per customer install.
#
# Template variable docs: https://docs.nuon.co/configuration-files
# =============================================================================""")

    # Infrastructure wiring
    has_pg = "postgresql" in infra_deps
    has_mysql = any(d in infra_deps for d in ("mysql", "mariadb"))
    has_redis = "redis" in infra_deps

    if has_pg:
        sections.append("""\

# --- PostgreSQL: disable bundled subchart, use Nuon-managed RDS ---
postgresql:
  enabled: false

externalDatabase:
  host: "{{ .nuon.components.rds.outputs.address }}"
  port: {{ .nuon.components.rds.outputs.db_instance_port }}
  database: "{{ .nuon.inputs.inputs.db_name }}"
  # TODO: wire credentials — use the Kubernetes secret created by the
  # db-credentials action, or reference inputs for username/password
  # existingSecret: \"""" + chart_name + """-db-credentials"
  # existingSecretPasswordKey: "password\""""
    )

    if has_mysql:
        sections.append("""\

# --- MySQL: disable bundled subchart, use Nuon-managed RDS ---
mysql:
  enabled: false

externalDatabase:
  host: "{{ .nuon.components.rds.outputs.address }}"
  port: 3306
  database: "{{ .nuon.inputs.inputs.db_name }}"
  # TODO: wire credentials from the db-credentials action""")

    if has_redis:
        sections.append("""\

# --- Redis: disable bundled subchart, use Nuon-managed ElastiCache ---
redis:
  enabled: false

# TODO: wire external Redis connection using your chart's key structure
# externalRedis:
#   host: "{{ .nuon.components.elasticache.outputs.endpoint }}"
#   port: 6379""")

    # Ingress wiring (active, not commented out)
    sections.append("""\

# --- Ingress ---
ingress:
  enabled: true
  hostname: "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}"
  annotations:
    external-dns.alpha.kubernetes.io/hostname: "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}"
  # TODO: Adapt the keys above to match your chart's ingress structure
  # (e.g. ingress.hosts[0].host, service.ingress.hostname, etc.)""")

    # Original values with password rewriting and conflict stripping
    if original_values:
        # Build list of top-level keys that we already define in the scaffold
        conflicting_keys = ["ingress"]
        if has_pg:
            conflicting_keys.extend(["postgresql", "externalDatabase"])
        if has_mysql:
            conflicting_keys.extend(["mysql", "externalDatabase"])
        if has_redis:
            conflicting_keys.append("redis")

        rewritten = _rewrite_passwords(original_values)
        rewritten = _strip_conflicting_keys(rewritten, conflicting_keys)
        sections.append(f"""\

# =============================================================================
# Original values.yaml from {chart_name}
#
# Passwords have been automatically replaced with Nuon input variables.
# Review and customize the remaining values. Replace static values with
# Nuon template variables where customer-specific configuration is needed.
#
# See https://docs.nuon.co/configuration-files for template variable syntax.
# =============================================================================

{rewritten}""")
    else:
        sections.append("""
# No values.yaml found in the chart source. Add your custom values below.
""")

    content = "\n".join(sections)
    filename = f"components/values/{chart_name}/values.yaml"
    return GeneratedFile(filename, "yaml", content)


_BOUNDARY_JSON = """\
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}"""


def _generate_permissions() -> list[GeneratedFile]:
    """Generate the 6 required permissions files (3 TOML roles + 3 JSON boundaries)."""
    files: list[GeneratedFile] = []
    for phase, desc in [
        ("provision", "provision the sandbox and components; trigger actions."),
        ("maintenance", "operate and remediate the app's components and use actions."),
        ("deprovision", "deprovision sandbox and components."),
    ]:
        toml_content = (
            f'type = "{phase}"\n'
            f'name = "{{{{.nuon.install.id}}}}-{phase}"\n'
            f'description = "{desc}"\n'
            f'display_name = "{phase} role"\n'
            f'permissions_boundary = "./{phase}_boundary.json"\n'
            f'\n'
            f'[[policies]]\n'
            f'managed_policy_name = "AdministratorAccess"'
        )
        files.append(GeneratedFile(f"permissions/{phase}.toml", "toml", toml_content))
        files.append(GeneratedFile(f"permissions/{phase}_boundary.json", "json", _BOUNDARY_JSON))
    return files


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------

def generate_config(
    chart: ChartInfo,
    cloud_provider: str = "",
    infra_mode: str = "",
    namespace: str = "",
    config_repo: str = "",
    infra_deps: list[str] | None = None,
) -> list[dict]:
    """Generate Nuon config files deterministically from chart info and user selections."""
    chart_name = chart.chart_name or "app"
    description = chart.chart_description or f"Nuon BYOC config for {chart_name}"
    ns = namespace or chart_name
    provider = cloud_provider or "aws"
    repo_ref = config_repo or "YOUR_ORG/YOUR_REPO"

    # Merge auto-detected + user-selected deps (deduplicate, preserve order)
    auto_detected = detect_infra_deps(chart.dependencies)
    selected = infra_deps or []
    all_deps = list(dict.fromkeys(auto_detected + selected))

    files: list[GeneratedFile] = []

    # 1. metadata.toml
    files.append(_generate_metadata(chart_name, description))

    # 2. inputs.toml
    files.append(_generate_inputs(chart_name, all_deps))

    # 3. sandbox.toml
    files.append(_generate_sandbox(provider))

    # 4. runner.toml
    files.append(_generate_runner(provider))

    # 5. permissions/
    files.extend(_generate_permissions())

    # 6. Infrastructure components
    has_db = any(d in all_deps for d in ("postgresql", "mysql", "mariadb"))
    has_cache = any(d in all_deps for d in ("redis", "memcached"))
    has_s3 = any(d in all_deps for d in ("minio", "s3"))

    infra_component_names: list[str] = []
    comp_number = 1

    if has_db:
        engine = "postgres"
        if any(d in all_deps for d in ("mysql", "mariadb")):
            engine = "mysql"
        files.extend(_generate_database_component(engine, chart_name, comp_number, repo_ref))
        infra_component_names.append("rds")
        comp_number += 1

    if has_cache:
        cache_engine = "redis" if "redis" in all_deps else "memcached"
        files.extend(_generate_elasticache_component(cache_engine, comp_number, repo_ref))
        infra_component_names.append("elasticache")
        comp_number += 1

    if has_s3:
        files.extend(_generate_s3_component(chart_name, comp_number, repo_ref))
        infra_component_names.append("s3")
        comp_number += 1

    # 6. Helm chart component
    files.append(_generate_app_component(
        chart_name=chart_name,
        org=chart.org,
        repo=chart.repo,
        branch=chart.branch,
        directory=chart.directory,
        namespace=ns,
        dep_component_names=infra_component_names,
        component_number=comp_number,
        helm_repo_url=chart.helm_repo_url,
    ))

    # 7. Values file
    files.append(_generate_values_file(chart_name, chart.values_yaml, all_deps))

    # 8. Actions
    if has_db:
        files.append(_generate_db_credentials_action(chart_name, ns))

    return [
        {"filename": f.filename, "language": f.language, "content": f.content}
        for f in files
    ]
