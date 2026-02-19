import type { HelmChart, GeneratedFile, ConfigOptions, ChartDependency } from "./types";

// ---------------------------------------------------------------------------
// Nuon template variables for the sidebar
// ---------------------------------------------------------------------------

export interface NuonVariable {
  name: string;
  template: string;
  description: string;
  category: string;
}

export const NUON_VARIABLES: NuonVariable[] = [
  { name: "Install ID", template: "{{.nuon.install.id}}", description: "Unique identifier for the install", category: "Install" },
  { name: "Install Name", template: "{{.nuon.install.name}}", description: "Name of the install", category: "Install" },
  { name: "Region", template: "{{.nuon.install_stack.outputs.region}}", description: "Cloud region from the install stack", category: "Install" },
  { name: "Public Domain", template: "{{.nuon.install.sandbox.outputs.nuon_dns.public_domain.name}}", description: "The public domain for this install", category: "Install" },

  { name: "Subdomain Input", template: "{{.nuon.inputs.inputs.subdomain}}", description: "Customer subdomain input", category: "Inputs" },
  { name: "Admin Password", template: "{{.nuon.inputs.inputs.admin_password}}", description: "Admin password input", category: "Inputs" },
  { name: "DB Name Input", template: "{{.nuon.inputs.inputs.db_name}}", description: "Database name input", category: "Inputs" },
  { name: "Custom Input", template: "{{.nuon.inputs.inputs.your_input_name}}", description: "Custom input defined in your app config", category: "Inputs" },

  { name: "VPC ID", template: "{{.nuon.install.sandbox.outputs.vpc.id}}", description: "VPC identifier from sandbox", category: "Sandbox" },
  { name: "Private Subnets", template: "{{index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 0}}", description: "First private subnet ID", category: "Sandbox" },
  { name: "Node Security Group", template: "{{.nuon.install.sandbox.outputs.cluster.node_security_group_id}}", description: "EKS node security group ID", category: "Sandbox" },

  { name: "RDS Address", template: "{{.nuon.components.rds.outputs.address}}", description: "RDS database endpoint address", category: "Components" },
  { name: "RDS Port", template: "{{.nuon.components.rds.outputs.db_instance_port}}", description: "RDS database port", category: "Components" },
  { name: "ElastiCache Endpoint", template: "{{.nuon.components.elasticache.outputs.endpoint}}", description: "ElastiCache endpoint", category: "Components" },
  { name: "S3 Bucket", template: "{{.nuon.components.s3.outputs.bucket_name}}", description: "S3 bucket name", category: "Components" },

  { name: "App ID", template: "{{.nuon.app.id}}", description: "The app identifier", category: "App" },
  { name: "App Name", template: "{{.nuon.app.name}}", description: "The app name", category: "App" },
];

// ---------------------------------------------------------------------------
// Infrastructure dependency mapping
// ---------------------------------------------------------------------------

export const KNOWN_INFRA_DEPS: Record<string, { component: string; engine: string | null; label: string }> = {
  postgresql: { component: "rds", engine: "postgres", label: "PostgreSQL (RDS)" },
  mysql: { component: "rds", engine: "mysql", label: "MySQL (RDS)" },
  mariadb: { component: "rds", engine: "mysql", label: "MariaDB (RDS)" },
  redis: { component: "elasticache", engine: "redis", label: "Redis (ElastiCache)" },
  memcached: { component: "elasticache", engine: "memcached", label: "Memcached (ElastiCache)" },
  minio: { component: "s3", engine: null, label: "S3-compatible Storage" },
};

const PASSWORD_PATTERN = /^(\s*)(password|adminPassword|admin-password|auth\.password|postgresqlPassword|postgresPassword|rootPassword|auth\.postgresPassword|auth\.adminPassword|repmgrPassword|srCheckPassword|mariadbPassword|mysqlPassword|redisPassword):\s*(.+)$/gm;

export function detectInfraDeps(dependencies: ChartDependency[]): string[] {
  const detected: string[] = [];
  for (const dep of dependencies) {
    const name = dep.name.toLowerCase();
    if (name in KNOWN_INFRA_DEPS && !detected.includes(name)) {
      detected.push(name);
    }
  }
  return detected;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function esc(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function rewritePasswords(values: string): string {
  return values.replace(PASSWORD_PATTERN, (_, indent, key) =>
    `${indent}${key}: "{{ .nuon.inputs.inputs.admin_password }}"`
  );
}

function stripConflictingKeys(values: string, keysToStrip: string[]): string {
  const lines = values.split("\n");
  const result: string[] = [];
  let skipping = false;

  for (const line of lines) {
    const stripped = line.trim();
    if (stripped && !stripped.startsWith("#") && !line.startsWith(" ") && !line.startsWith("\t")) {
      const keyName = stripped.includes(":") ? stripped.split(":")[0].trim() : "";
      if (keysToStrip.includes(keyName)) {
        skipping = true;
        result.push(`# [${keyName}: overridden by Nuon wiring above]`);
        continue;
      } else {
        skipping = false;
      }
    }

    if (skipping) {
      if (!stripped || line.startsWith(" ") || line.startsWith("\t") || stripped.startsWith("#")) {
        continue;
      } else {
        skipping = false;
      }
    }
    result.push(line);
  }
  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Individual file generators
// ---------------------------------------------------------------------------

function generateMetadata(chartName: string, description: string): GeneratedFile {
  const desc = description || `Nuon BYOC config for ${chartName}`;
  return {
    filename: "metadata.toml",
    language: "toml",
    content: `# metadata
version = "v2"
description = "${esc(desc)}"
display_name = "${esc(chartName)}"`,
  };
}

function generateSandbox(cloudProvider: string): GeneratedFile {
  if (cloudProvider === "azure") {
    return {
      filename: "sandbox.toml",
      language: "toml",
      content: `# sandbox
name = "aks"
terraform_version = "1.11.3"

[public_repo]
repo = "nuonco/azure-aks-sandbox"
branch = "main"
directory = "."`,
    };
  }
  return {
    filename: "sandbox.toml",
    language: "toml",
    content: `# sandbox
name = "eks"
terraform_version = "1.11.3"

[public_repo]
repo = "nuonco/aws-eks-sandbox"
branch = "main"
directory = "."`,
  };
}

function generateRunner(cloudProvider: string): GeneratedFile {
  const runner = cloudProvider === "azure" ? "azure" : "aws";
  return {
    filename: "runner.toml",
    language: "toml",
    content: `# runner
runner_type = "${runner}"`,
  };
}

function generateStack(chartName: string): GeneratedFile {
  const safeName = chartName.toLowerCase().replace(/_/g, "-");
  return {
    filename: "stack.toml",
    language: "toml",
    content: `# stack
type = "aws-cloudformation"
name = "nuon-${esc(safeName)}-{{.nuon.install.id}}"
description = "QuickLink to install runner for the ${esc(chartName)} app config: Install {{.nuon.install.id}}"

vpc_nested_template_url = "https://nuon-artifacts.s3.us-west-2.amazonaws.com/aws-cloudformation-templates/v0.2.1/vpc/eks/default/stack.yaml"
runner_nested_template_url = "https://nuon-artifacts.s3.us-west-2.amazonaws.com/aws-cloudformation-templates/v0.2.1/runner/asg/stack.yaml"`,
  };
}

function generateBreakGlass(): GeneratedFile {
  return {
    filename: "break_glass.toml",
    language: "toml",
    content: `[[role]]
name = "{{.nuon.install.id}}-break-glass"
description = "Break-glass role for emergency access"
display_name = "Break Glass"
permissions_boundary = ""

[[role.policies]]
managed_policy_name = "AdministratorAccess"`,
  };
}

const BOUNDARY_JSON = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "*",
      "Resource": "*"
    }
  ]
}`;

function generatePermissions(): GeneratedFile[] {
  const phases: [string, string][] = [
    ["provision", "provision the sandbox and components; trigger actions."],
    ["maintenance", "operate and remediate the app's components and use actions."],
    ["deprovision", "deprovision sandbox and components."],
  ];
  const files: GeneratedFile[] = [];
  for (const [phase, desc] of phases) {
    files.push({
      filename: `permissions/${phase}.toml`,
      language: "toml",
      content: `type = "${phase}"
name = "{{.nuon.install.id}}-${phase}"
description = "${desc}"
display_name = "${phase} role"
permissions_boundary = "./${phase}_boundary.json"

[[policies]]
managed_policy_name = "AdministratorAccess"`,
    });
    files.push({
      filename: `permissions/${phase}_boundary.json`,
      language: "json",
      content: BOUNDARY_JSON,
    });
  }
  return files;
}

function generateInputs(chartName: string, infraDeps: string[]): GeneratedFile {
  const lines = [
    "# inputs",
    "",
    "# --- Groups ---",
    "",
    "[[group]]",
    'name = "application"',
    'description = "Core application settings"',
    'display_name = "Application"',
    "",
    "[[group]]",
    'name = "networking"',
    'description = "Domain and ingress settings"',
    'display_name = "Networking"',
    "",
    "# --- Inputs ---",
    "",
    "[[input]]",
    'name = "subdomain"',
    `description = "Subdomain for ${esc(chartName)} (e.g. 'app' for app.customer.nuon.run)"`,
    `default = "${esc(chartName)}"`,
    'display_name = "Subdomain"',
    'group = "networking"',
    "",
    "[[input]]",
    'name = "admin_password"',
    `description = "Initial admin password for ${esc(chartName)}"`,
    'default = ""',
    'display_name = "Admin Password"',
    'group = "application"',
    "sensitive = true",
    "required = true",
  ];

  const hasDb = infraDeps.some((d) => ["postgresql", "mysql", "mariadb"].includes(d));
  if (hasDb) {
    const dbDefault = chartName.replace(/-/g, "_");
    lines.push(
      "",
      "[[group]]",
      'name = "database"',
      'description = "Database configuration"',
      'display_name = "Database"',
      "",
      "[[input]]",
      'name = "db_name"',
      `description = "Database name for ${esc(chartName)}"`,
      `default = "${esc(dbDefault)}"`,
      'display_name = "Database Name"',
      'group = "database"',
    );
  }

  return { filename: "inputs.toml", language: "toml", content: lines.join("\n") };
}

function generateDatabaseComponent(engine: string, chartName: string, number: number, configRepo: string): GeneratedFile[] {
  const engineLabel = engine === "postgres" ? "PostgreSQL" : "MySQL";
  const tfDir = `components/${number}-rds`;
  const dbEngine = engine === "postgres" ? "postgres" : "mysql";
  const dbPort = engine === "postgres" ? "5432" : "3306";
  const repo = configRepo || "YOUR_ORG/YOUR_REPO";

  const todo = configRepo
    ? ""
    : `\n#\n# TODO: After pushing this config to your GitHub repo, update [public_repo]\n# to point to your repo. The Terraform code is in ${tfDir}/`;

  const toml: GeneratedFile = {
    filename: `components/${number}-rds.toml`,
    language: "toml",
    content: `# terraform
name = "rds"
type = "terraform_module"
terraform_version = "1.11.3"
# Provisions an RDS ${engineLabel} instance for ${chartName}${todo}

[public_repo]
repo = "${esc(repo)}"
directory = "${tfDir}"
branch = "main"

[vars]
region = "{{ .nuon.install_stack.outputs.region }}"
install_id = "{{ .nuon.install.id }}"
vpc_id = "{{ .nuon.install.sandbox.outputs.vpc.id }}"
private_subnet_ids = "{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 0 }},{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 1 }},{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 2 }}"
node_security_group_id = "{{ .nuon.install.sandbox.outputs.cluster.node_security_group_id }}"
db_name = "{{ .nuon.inputs.inputs.db_name }}"
instance_class = "db.t3.medium"`,
  };

  const engineVersion = engine === "postgres" ? "15.4" : "8.0";
  const tf: GeneratedFile = {
    filename: `${tfDir}/main.tf`,
    language: "hcl",
    content: `variable "region" {
  type = string
}

variable "install_id" {
  type = string
}

variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = string
}

variable "node_security_group_id" {
  type = string
}

variable "db_name" {
  type    = string
  default = "${chartName.replace(/-/g, "_")}"
}

variable "instance_class" {
  type    = string
  default = "db.t3.medium"
}

locals {
  subnet_ids = split(",", var.private_subnet_ids)
}

resource "aws_db_subnet_group" "this" {
  name       = "\${var.install_id}-${chartName}"
  subnet_ids = local.subnet_ids

  tags = {
    Name      = "\${var.install_id}-${chartName}"
    ManagedBy = "nuon"
  }
}

resource "aws_security_group" "rds" {
  name_prefix = "\${var.install_id}-${chartName}-rds-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = ${dbPort}
    to_port         = ${dbPort}
    protocol        = "tcp"
    security_groups = [var.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name      = "\${var.install_id}-${chartName}-rds"
    ManagedBy = "nuon"
  }
}

resource "aws_db_instance" "this" {
  identifier     = "\${var.install_id}-${chartName}"
  engine         = "${dbEngine}"
  engine_version = "${engineVersion}"
  instance_class = var.instance_class

  db_name                     = var.db_name
  username                    = "admin"
  manage_master_user_password = true

  allocated_storage     = 20
  max_allocated_storage = 100
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]

  multi_az            = false
  skip_final_snapshot = true
  deletion_protection = false

  tags = {
    Name      = "\${var.install_id}-${chartName}"
    ManagedBy = "nuon"
  }
}

output "address" {
  value = aws_db_instance.this.address
}

output "db_instance_port" {
  value = tostring(aws_db_instance.this.port)
}

output "db_instance_master_user_secret_arn" {
  value = aws_db_instance.this.master_user_secret[0].secret_arn
}`,
  };

  return [toml, tf];
}

function generateElasticacheComponent(engine: string, number: number, configRepo: string): GeneratedFile[] {
  const tfDir = `components/${number}-elasticache`;
  const repo = configRepo || "YOUR_ORG/YOUR_REPO";
  const todo = configRepo
    ? ""
    : `\n#\n# TODO: After pushing this config to your GitHub repo, update [public_repo]\n# to point to your repo. The Terraform code is in ${tfDir}/`;

  const toml: GeneratedFile = {
    filename: `components/${number}-elasticache.toml`,
    language: "toml",
    content: `# terraform
name = "elasticache"
type = "terraform_module"
terraform_version = "1.11.3"${todo}

[public_repo]
repo = "${esc(repo)}"
directory = "${tfDir}"
branch = "main"

[vars]
region = "{{ .nuon.install_stack.outputs.region }}"
install_id = "{{ .nuon.install.id }}"
vpc_id = "{{ .nuon.install.sandbox.outputs.vpc.id }}"
private_subnet_ids = "{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 0 }},{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 1 }},{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 2 }}"
node_security_group_id = "{{ .nuon.install.sandbox.outputs.cluster.node_security_group_id }}"
node_type = "cache.t3.small"
engine_version = "7.0"`,
  };

  const tf: GeneratedFile = {
    filename: `${tfDir}/main.tf`,
    language: "hcl",
    content: `variable "region" { type = string }
variable "install_id" { type = string }
variable "vpc_id" { type = string }
variable "private_subnet_ids" { type = string }
variable "node_security_group_id" { type = string }
variable "node_type" { type = string; default = "cache.t3.small" }
variable "engine_version" { type = string; default = "7.0" }

locals {
  subnet_ids = split(",", var.private_subnet_ids)
}

resource "aws_elasticache_subnet_group" "this" {
  name       = "\${var.install_id}-cache"
  subnet_ids = local.subnet_ids
}

resource "aws_security_group" "cache" {
  name_prefix = "\${var.install_id}-cache-"
  vpc_id      = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_elasticache_cluster" "this" {
  cluster_id         = "\${var.install_id}-cache"
  engine             = "${engine}"
  engine_version     = var.engine_version
  node_type          = var.node_type
  num_cache_nodes    = 1
  subnet_group_name  = aws_elasticache_subnet_group.this.name
  security_group_ids = [aws_security_group.cache.id]
}

output "endpoint" {
  value = aws_elasticache_cluster.this.cache_nodes[0].address
}`,
  };

  return [toml, tf];
}

function generateS3Component(chartName: string, number: number, configRepo: string): GeneratedFile[] {
  const tfDir = `components/${number}-s3`;
  const repo = configRepo || "YOUR_ORG/YOUR_REPO";
  const todo = configRepo
    ? ""
    : `\n#\n# TODO: After pushing this config to your GitHub repo, update [public_repo]\n# to point to your repo. The Terraform code is in ${tfDir}/`;

  const toml: GeneratedFile = {
    filename: `components/${number}-s3.toml`,
    language: "toml",
    content: `# terraform
name = "s3"
type = "terraform_module"
terraform_version = "1.11.3"${todo}

[public_repo]
repo = "${esc(repo)}"
directory = "${tfDir}"
branch = "main"

[vars]
region = "{{ .nuon.install_stack.outputs.region }}"
install_id = "{{ .nuon.install.id }}"
prefix = "${esc(chartName)}"`,
  };

  const tf: GeneratedFile = {
    filename: `${tfDir}/main.tf`,
    language: "hcl",
    content: `variable "region" { type = string }
variable "install_id" { type = string }
variable "prefix" { type = string; default = "${esc(chartName)}" }

resource "aws_s3_bucket" "this" {
  bucket = "\${var.install_id}-\${var.prefix}"

  tags = {
    Name      = "\${var.install_id}-\${var.prefix}"
    ManagedBy = "nuon"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

output "bucket_name" {
  value = aws_s3_bucket.this.id
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}`,
  };

  return [toml, tf];
}

function generateAppComponent(
  chartName: string,
  org: string,
  repo: string,
  directory: string,
  branch: string,
  namespace: string,
  depComponentNames: string[],
  componentNumber: number,
): GeneratedFile {
  const depLine = depComponentNames.length > 0
    ? `dependencies = [${depComponentNames.map((d) => `"${d}"`).join(", ")}]`
    : "# dependencies = []";

  return {
    filename: `components/${componentNumber}-${chartName}.toml`,
    language: "toml",
    content: `# helm
name = "${esc(chartName)}"
type = "helm_chart"
chart_name = "${esc(chartName)}"
namespace = "${esc(namespace)}"
storage_driver = "configmap"
${depLine}

[public_repo]
repo = "${esc(org)}/${esc(repo)}"
directory = "${esc(directory)}"
branch = "${esc(branch)}"

[[values_file]]
contents = "./values/${esc(chartName)}/values.yaml"`,
  };
}

function generateDbCredentialsAction(chartName: string, namespace: string): GeneratedFile {
  return {
    filename: "actions/db-credentials.toml",
    language: "toml",
    content: `# action
name = "create_db_secret"
timeout = "2m"

[[triggers]]
type = "post-deploy-component"
component_name = "rds"

[[triggers]]
type = "manual"

[[steps]]
name = "Copy RDS credentials to Kubernetes secret"
command = "./import.sh"

[steps.public_repo]
repo = "nuonco/example-app-configs"
directory = "shared/actions/rds-secrets"
branch = "main"

[steps.env_vars]
SECRET_ARN = "{{ .nuon.components.rds.outputs.db_instance_master_user_secret_arn }}"
REGION = "{{ .nuon.install_stack.outputs.region }}"
TARGET_NAME = "${esc(chartName)}-db-credentials"
TARGET_NAMESPACE = "${esc(namespace)}"`,
  };
}

function generateValuesFile(
  chartName: string,
  originalValues: string | null,
  infraDeps: string[],
): GeneratedFile {
  const sections: string[] = [];

  sections.push(`# =============================================================================
# Nuon-templated values for ${chartName}
# =============================================================================
#
# TODO: Review the sections below. Wire Nuon template variables to the
# Helm values that should be configurable per customer install.
#
# Template variable docs: https://docs.nuon.co/configuration-files
# =============================================================================`);

  const hasPg = infraDeps.includes("postgresql");
  const hasMysql = infraDeps.some((d) => ["mysql", "mariadb"].includes(d));
  const hasRedis = infraDeps.includes("redis");

  if (hasPg) {
    sections.push(`
# --- PostgreSQL: disable bundled subchart, use Nuon-managed RDS ---
postgresql:
  enabled: false

externalDatabase:
  host: "{{ .nuon.components.rds.outputs.address }}"
  port: {{ .nuon.components.rds.outputs.db_instance_port }}
  database: "{{ .nuon.inputs.inputs.db_name }}"
  # TODO: wire credentials — use the Kubernetes secret created by the
  # db-credentials action, or reference inputs for username/password
  # existingSecret: "${chartName}-db-credentials"
  # existingSecretPasswordKey: "password"`);
  }

  if (hasMysql) {
    sections.push(`
# --- MySQL: disable bundled subchart, use Nuon-managed RDS ---
mysql:
  enabled: false

externalDatabase:
  host: "{{ .nuon.components.rds.outputs.address }}"
  port: 3306
  database: "{{ .nuon.inputs.inputs.db_name }}"
  # TODO: wire credentials from the db-credentials action`);
  }

  if (hasRedis) {
    sections.push(`
# --- Redis: disable bundled subchart, use Nuon-managed ElastiCache ---
redis:
  enabled: false

# TODO: wire external Redis connection using your chart's key structure
# externalRedis:
#   host: "{{ .nuon.components.elasticache.outputs.endpoint }}"
#   port: 6379`);
  }

  sections.push(`
# --- Ingress ---
ingress:
  enabled: true
  hostname: "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}"
  annotations:
    external-dns.alpha.kubernetes.io/hostname: "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}"
  # TODO: Adapt the keys above to match your chart's ingress structure
  # (e.g. ingress.hosts[0].host, service.ingress.hostname, etc.)`);

  if (originalValues) {
    const conflictingKeys = ["ingress"];
    if (hasPg) conflictingKeys.push("postgresql", "externalDatabase");
    if (hasMysql) conflictingKeys.push("mysql", "externalDatabase");
    if (hasRedis) conflictingKeys.push("redis");

    let rewritten = rewritePasswords(originalValues);
    rewritten = stripConflictingKeys(rewritten, conflictingKeys);
    sections.push(`
# =============================================================================
# Original values.yaml from ${chartName}
#
# Passwords have been automatically replaced with Nuon input variables.
# Review and customize the remaining values. Replace static values with
# Nuon template variables where customer-specific configuration is needed.
#
# See https://docs.nuon.co/configuration-files for template variable syntax.
# =============================================================================

${rewritten}`);
  } else {
    sections.push(`
# No values.yaml found in the chart source. Add your custom values below.
`);
  }

  return {
    filename: `components/values/${chartName}/values.yaml`,
    language: "yaml",
    content: sections.join("\n"),
  };
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export function generateNuonConfig(
  repoFullName: string,
  chart: HelmChart,
  valuesYaml: string,
  options: ConfigOptions,
): GeneratedFile[] {
  const chartName = chart.name || "app";
  const description = chart.description || `Nuon BYOC config for ${chartName}`;
  const ns = options.namespace || chartName;
  const provider = options.cloudProvider || "aws";
  const infraMode = options.infraMode || "default";
  const repoRef = options.configRepo || "YOUR_ORG/YOUR_REPO";
  const [org, repo] = repoFullName.split("/");
  const branch = "main";
  const directory = chart.path || ".";

  const autoDetected = detectInfraDeps(chart.dependencies || []);
  const allDeps = [...new Set([...autoDetected, ...options.infraDeps])];

  const files: GeneratedFile[] = [];

  files.push(generateMetadata(chartName, description));
  files.push(generateInputs(chartName, allDeps));

  if (infraMode !== "bring-cluster") {
    files.push(generateSandbox(provider));
    files.push(generateRunner(provider));
    files.push(generateStack(chartName));
    files.push(generateBreakGlass());
    files.push(...generatePermissions());
  }

  const hasDb = allDeps.some((d) => ["postgresql", "mysql", "mariadb"].includes(d));
  const hasCache = allDeps.some((d) => ["redis", "memcached"].includes(d));
  const hasS3 = allDeps.some((d) => ["minio", "s3"].includes(d));

  const infraComponentNames: string[] = [];
  let compNumber = 1;

  if (hasDb) {
    const engine = allDeps.some((d) => ["mysql", "mariadb"].includes(d)) ? "mysql" : "postgres";
    files.push(...generateDatabaseComponent(engine, chartName, compNumber, repoRef));
    infraComponentNames.push("rds");
    compNumber++;
  }

  if (hasCache) {
    const cacheEngine = allDeps.includes("redis") ? "redis" : "memcached";
    files.push(...generateElasticacheComponent(cacheEngine, compNumber, repoRef));
    infraComponentNames.push("elasticache");
    compNumber++;
  }

  if (hasS3) {
    files.push(...generateS3Component(chartName, compNumber, repoRef));
    infraComponentNames.push("s3");
    compNumber++;
  }

  files.push(generateAppComponent(
    chartName, org, repo, directory, branch, ns,
    infraComponentNames, compNumber,
  ));

  files.push(generateValuesFile(chartName, valuesYaml || null, allDeps));

  if (hasDb) {
    files.push(generateDbCredentialsAction(chartName, ns));
  }

  return files;
}
