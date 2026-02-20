import type { HelmChart, GeneratedFile, ConfigOptions, ChartDependency } from "./types";
import yaml from "js-yaml";

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

// --- YAML analysis helpers for generateValuesFile ---

const INFRA_KEY_PATTERNS: Record<string, RegExp> = {
  postgresql: /^(postgresql|postgres|postgresql-ha)$/i,
  mysql: /^(mysql|mariadb)$/i,
  mariadb: /^(mariadb|mysql)$/i,
  redis: /^(redis|valkey|valkey-cluster|redis-cluster|redis-ha)$/i,
  memcached: /^(memcached)$/i,
  minio: /^(minio|s3)$/i,
};

const PASSWORD_KEYS = /^(password|adminPassword|admin-password|rootPassword|postgresqlPassword|postgresPassword|mariadbPassword|mysqlPassword|redisPassword|repmgrPassword|srCheckPassword)$/;

interface IngressInfo {
  exists: boolean;
  keyPath: string[];
  structure: "hostname" | "hosts-array" | "unknown";
}

interface PasswordField {
  path: string[];
  value: string;
}

/** Scan top-level values.yaml keys to find the chart's actual names for infra deps */
function findInfraKeys(parsed: Record<string, unknown>, infraDeps: string[]): Record<string, string[]> {
  const topKeys = Object.keys(parsed);
  const result: Record<string, string[]> = {};
  for (const dep of infraDeps) {
    const pattern = INFRA_KEY_PATTERNS[dep];
    if (!pattern) continue;
    const matches = topKeys.filter((k) => pattern.test(k));
    if (matches.length > 0) result[dep] = matches;
  }
  return result;
}

/** Detect the chart's ingress structure (flat hostname vs hosts array) */
function detectIngressStructure(parsed: Record<string, unknown>, path: string[] = []): IngressInfo {
  const none: IngressInfo = { exists: false, keyPath: [], structure: "unknown" };

  if (parsed.ingress && typeof parsed.ingress === "object" && !Array.isArray(parsed.ingress)) {
    const ing = parsed.ingress as Record<string, unknown>;
    if ("hostname" in ing) return { exists: true, keyPath: [...path, "ingress"], structure: "hostname" };
    if ("hosts" in ing && Array.isArray(ing.hosts)) return { exists: true, keyPath: [...path, "ingress"], structure: "hosts-array" };
    if ("enabled" in ing || "host" in ing || "tls" in ing) return { exists: true, keyPath: [...path, "ingress"], structure: "unknown" };
  }

  // Check one level deep (e.g. server.ingress)
  if (path.length === 0) {
    for (const [key, value] of Object.entries(parsed)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = detectIngressStructure(value as Record<string, unknown>, [key]);
        if (nested.exists) return nested;
      }
    }
  }

  return none;
}

/** Walk the parsed YAML tree and return paths to password-like fields */
function findPasswordPaths(obj: unknown, path: string[] = []): PasswordField[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
  const results: PasswordField[] = [];
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === "string" && value !== "" && PASSWORD_KEYS.test(key)) {
      results.push({ path: [...path, key], value });
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      results.push(...findPasswordPaths(value, [...path, key]));
    }
  }
  return results;
}

/** Emit nested YAML: given a key path and content lines, produce indented output */
function emitNestedYaml(keyPath: string[], contentLines: string[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < keyPath.length; i++) {
    lines.push("  ".repeat(i) + keyPath[i] + ":");
  }
  const base = "  ".repeat(keyPath.length);
  for (const cl of contentLines) {
    lines.push(base + cl);
  }
  return lines;
}

/** Build a tree from password field paths and serialize to YAML lines */
function emitPasswordOverrides(passwords: PasswordField[]): string[] {
  if (passwords.length === 0) return [];
  const tree: Record<string, unknown> = {};
  for (const pw of passwords) {
    let current: Record<string, unknown> = tree;
    for (let i = 0; i < pw.path.length - 1; i++) {
      const seg = pw.path[i];
      if (!(seg in current) || typeof current[seg] !== "object") current[seg] = {};
      current = current[seg] as Record<string, unknown>;
    }
    current[pw.path[pw.path.length - 1]] = "{{ .nuon.inputs.inputs.admin_password }}";
  }

  const lines: string[] = [];
  function serialize(obj: Record<string, unknown>, indent: number) {
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        lines.push("  ".repeat(indent) + `${key}: "${value}"`);
      } else {
        lines.push("  ".repeat(indent) + `${key}:`);
        serialize(value as Record<string, unknown>, indent + 1);
      }
    }
  }
  serialize(tree, 0);
  return lines;
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

  const toml: GeneratedFile = {
    filename: `components/${number}-rds.toml`,
    language: "toml",
    content: `# terraform
name = "rds"
type = "terraform_module"
terraform_version = "1.11.3"

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
  const toml: GeneratedFile = {
    filename: `components/${number}-elasticache.toml`,
    language: "toml",
    content: `# terraform
name = "elasticache"
type = "terraform_module"
terraform_version = "1.11.3"

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
  const toml: GeneratedFile = {
    filename: `components/${number}-s3.toml`,
    language: "toml",
    content: `# terraform
name = "s3"
type = "terraform_module"
terraform_version = "1.11.3"

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
  const lines: string[] = [];

  // Header
  lines.push(`# Nuon values for ${chartName}`);
  lines.push("# https://docs.nuon.co/guides/helm-chart-components");

  // Parse original values for structured analysis
  let parsed: Record<string, unknown> = {};
  if (originalValues) {
    try {
      const loaded = yaml.load(originalValues);
      if (loaded && typeof loaded === "object") parsed = loaded as Record<string, unknown>;
    } catch {
      // parse failed — proceed with empty object
    }
  }

  const infraKeys = findInfraKeys(parsed, infraDeps);

  // Collect all keys being disabled so we can skip their password fields
  const disabledKeys = new Set<string>();
  for (const keys of Object.values(infraKeys)) {
    for (const k of keys) disabledKeys.add(k);
  }

  // --- Database ---
  const hasPg = infraDeps.includes("postgresql");
  const hasMysql = infraDeps.some((d) => ["mysql", "mariadb"].includes(d));

  if (hasPg || hasMysql) {
    const depName = hasPg ? "postgresql" : infraDeps.includes("mysql") ? "mysql" : "mariadb";
    const keysToDisable = infraKeys[depName] || [depName];

    lines.push("");
    for (const key of keysToDisable) {
      lines.push(`${key}:`);
      lines.push("  enabled: false");
    }

    lines.push("");
    lines.push("externalDatabase:");
    lines.push(`  host: "{{ .nuon.components.rds.outputs.address }}"`);
    lines.push("  port: {{ .nuon.components.rds.outputs.db_instance_port }}");
    lines.push(`  database: "{{ .nuon.inputs.inputs.db_name }}"`);
    lines.push(`  existingSecret: "${chartName}-db-credentials"`);
    lines.push('  existingSecretPasswordKey: "password"');
  }

  // --- Cache ---
  const hasRedis = infraDeps.includes("redis");
  const hasMemcached = infraDeps.includes("memcached");

  if (hasRedis || hasMemcached) {
    const depName = hasRedis ? "redis" : "memcached";
    const keysToDisable = infraKeys[depName] || [depName];

    lines.push("");
    for (const key of keysToDisable) {
      lines.push(`${key}:`);
      lines.push("  enabled: false");
    }

    lines.push("");
    lines.push("externalRedis:");
    lines.push(`  host: "{{ .nuon.components.elasticache.outputs.endpoint }}"`);
    lines.push("  port: 6379");
  }

  // --- S3 ---
  const hasS3 = infraDeps.some((d) => ["minio", "s3"].includes(d));
  if (hasS3) {
    const depName = infraDeps.includes("minio") ? "minio" : "s3";
    const keysToDisable = infraKeys[depName] || [];

    if (keysToDisable.length > 0) {
      lines.push("");
      for (const key of keysToDisable) {
        lines.push(`${key}:`);
        lines.push("  enabled: false");
      }
    }

    lines.push("");
    lines.push("# S3 bucket: {{ .nuon.components.s3.outputs.bucket_name }}");
  }

  // --- Ingress ---
  const ingressInfo = detectIngressStructure(parsed);
  if (ingressInfo.exists) {
    const domain = "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}";
    lines.push("");

    if (ingressInfo.structure === "hostname") {
      lines.push(...emitNestedYaml(ingressInfo.keyPath, [
        "enabled: true",
        `hostname: "${domain}"`,
        "annotations:",
        `  external-dns.alpha.kubernetes.io/hostname: "${domain}"`,
      ]));
    } else if (ingressInfo.structure === "hosts-array") {
      lines.push(...emitNestedYaml(ingressInfo.keyPath, [
        "enabled: true",
        "hosts:",
        `  - host: "${domain}"`,
        "    paths:",
        "      - path: /",
        "annotations:",
        `  external-dns.alpha.kubernetes.io/hostname: "${domain}"`,
      ]));
    } else {
      lines.push(...emitNestedYaml(ingressInfo.keyPath, [
        "enabled: true",
        `hostname: "${domain}"`,
        "annotations:",
        `  external-dns.alpha.kubernetes.io/hostname: "${domain}"`,
      ]));
    }
  }

  // --- Password overrides (skip fields under disabled subchart keys) ---
  const passwords = findPasswordPaths(parsed).filter(
    (pw) => pw.path.length < 2 || !disabledKeys.has(pw.path[0]),
  );
  const pwLines = emitPasswordOverrides(passwords);
  if (pwLines.length > 0) {
    lines.push("");
    lines.push(...pwLines);
  }

  // If nothing beyond the header was generated
  if (lines.length <= 2) {
    lines.push("");
    lines.push("# Add your Nuon template variable overrides below");
  }

  return {
    filename: `components/values/${chartName}/values.yaml`,
    language: "yaml",
    content: lines.join("\n") + "\n",
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
