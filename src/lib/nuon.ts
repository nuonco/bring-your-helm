import type { HelmChart, GeneratedFile, ConfigOptions, ChartDependency, ChartFile } from "./types";
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

/**
 * Resolve a dot-separated path against a nested object.
 * Returns undefined if any segment is missing or hits a non-object.
 */
function resolveValuePath(
  obj: Record<string, unknown>,
  dotPath: string,
): unknown {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Replace non-Nuon Go template expressions in a YAML string.
 *
 * - {{ .Values.some.path }}  → resolved from valuesObj, or stripped
 * - {{ .Values.x | default "y" }} → resolved, with "y" as fallback
 * - {{ .Chart.* }}, {{ .Release.* }} → stripped
 * - {{ include/template ... }} → stripped
 * - {{ if/else/end/range/with }} → stripped
 * - {{ .nuon.* }} → left intact
 */
export function sanitizeGoTemplates(
  yamlContent: string,
  valuesObj: Record<string, unknown>,
): string {
  const GO_TEMPLATE_RE = /\{\{-?\s*(.*?)\s*-?\}\}/g;

  return yamlContent.replace(GO_TEMPLATE_RE, (fullMatch, innerExpr: string) => {
    const expr = innerExpr.trim();

    // Preserve all .nuon.* expressions (including "index .nuon.*")
    if (expr.startsWith(".nuon.") || expr.startsWith("index .nuon.")) {
      return fullMatch;
    }

    // Handle .Values.* expressions — resolve from valuesObj
    const valuesMatch = expr.match(/^\.Values\.(\S+?)(?:\s*\|.*)?$/);
    if (valuesMatch) {
      const path = valuesMatch[1];
      const resolved = resolveValuePath(valuesObj, path);

      if (resolved !== undefined && resolved !== null && typeof resolved !== "object") {
        return String(resolved);
      }

      // Try | default "..." fallback
      const defaultMatch = expr.match(/\|\s*default\s+"([^"]*)"/);
      if (defaultMatch) {
        return defaultMatch[1];
      }
      const defaultMatchSingle = expr.match(/\|\s*default\s+'([^']*)'/);
      if (defaultMatchSingle) {
        return defaultMatchSingle[1];
      }

      // Unresolvable — empty string
      return "";
    }

    // Handle `index .Values.* "key"` expressions
    const indexValuesMatch = expr.match(/^index\s+\.Values\.(\S+)\s+"([^"]+)"/);
    if (indexValuesMatch) {
      const parent = resolveValuePath(valuesObj, indexValuesMatch[1]);
      if (parent && typeof parent === "object" && !Array.isArray(parent)) {
        const val = (parent as Record<string, unknown>)[indexValuesMatch[2]];
        if (val !== undefined && val !== null && typeof val !== "object") {
          return String(val);
        }
      }
      return "";
    }

    // All other non-Nuon expressions: strip
    return "";
  });
}

// ---------------------------------------------------------------------------
// YAML analysis helpers for minimal override generation
// ---------------------------------------------------------------------------

const INFRA_KEY_PATTERNS: Record<string, RegExp> = {
  postgresql: /^(postgresql|postgres|postgresql-ha)$/i,
  mysql: /^(mysql|mariadb|mysql-ha)$/i,
  redis: /^(redis|redis-cluster|redis-master|valkey|valkey-cluster)$/i,
  memcached: /^(memcached)$/i,
  minio: /^(minio|s3)$/i,
};

interface IngressInfo {
  type: "flat" | "hosts-array";
  key: string;
}

interface PasswordField {
  path: string[];
}

function findInfraKeys(
  parsed: Record<string, unknown>,
  infraDeps: string[],
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const topKeys = Object.keys(parsed);
  for (const dep of infraDeps) {
    const pattern = INFRA_KEY_PATTERNS[dep];
    if (!pattern) continue;
    const matches = topKeys.filter((k) => pattern.test(k));
    if (matches.length > 0) result.set(dep, matches);
  }
  return result;
}

function detectIngressStructure(
  parsed: Record<string, unknown>,
): IngressInfo | null {
  const ingress = parsed.ingress as Record<string, unknown> | undefined;
  if (ingress && typeof ingress === "object") {
    if (Array.isArray(ingress.hosts))
      return { type: "hosts-array", key: "ingress" };
    if ("hostname" in ingress) return { type: "flat", key: "ingress" };
    return { type: "hosts-array", key: "ingress" };
  }
  for (const key of Object.keys(parsed)) {
    const val = parsed[key] as Record<string, unknown> | undefined;
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const inner = val.ingress as Record<string, unknown> | undefined;
      if (inner && typeof inner === "object") {
        if (Array.isArray(inner.hosts))
          return { type: "hosts-array", key: `${key}.ingress` };
        if ("hostname" in inner)
          return { type: "flat", key: `${key}.ingress` };
      }
    }
  }
  return null;
}

function findPasswordPaths(
  obj: unknown,
  path: string[] = [],
): PasswordField[] {
  const results: PasswordField[] = [];
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return results;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const currentPath = [...path, key];
    if (typeof value === "string" || typeof value === "number") {
      if (key.toLowerCase().includes("password")) {
        results.push({ path: currentPath });
      }
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      results.push(...findPasswordPaths(value, currentPath));
    }
  }
  return results;
}

function emitNestedYaml(
  keyPath: string[],
  value: string,
  indent: number = 0,
): string {
  const prefix = "  ".repeat(indent);
  if (keyPath.length === 1) return `${prefix}${keyPath[0]}: ${value}`;
  return `${prefix}${keyPath[0]}:\n${emitNestedYaml(keyPath.slice(1), value, indent + 1)}`;
}

function emitPasswordOverrides(fields: PasswordField[]): string {
  if (fields.length === 0) return "";
  const lines: string[] = [];
  const tree: Record<string, unknown> = {};
  for (const field of fields) {
    let node: Record<string, unknown> = tree;
    for (let i = 0; i < field.path.length - 1; i++) {
      if (!(field.path[i] in node))
        node[field.path[i]] = {} as Record<string, unknown>;
      node = node[field.path[i]] as Record<string, unknown>;
    }
    node[field.path[field.path.length - 1]] =
      '"{{ .nuon.inputs.inputs.admin_password }}"';
  }
  function serialize(obj: Record<string, unknown>, indent: number): void {
    for (const [key, val] of Object.entries(obj)) {
      const prefix = "  ".repeat(indent);
      if (typeof val === "string") {
        lines.push(`${prefix}${key}: ${val}`);
      } else {
        lines.push(`${prefix}${key}:`);
        serialize(val as Record<string, unknown>, indent + 1);
      }
    }
  }
  serialize(tree, 0);
  return lines.join("\n");
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

function generateSandbox(cloudProvider: string): GeneratedFile[] {
  if (cloudProvider === "azure") {
    return [{
      filename: "sandbox.toml",
      language: "toml",
      content: `# sandbox
name = "aks"
terraform_version = "1.11.3"

[public_repo]
repo = "nuonco/azure-aks-sandbox"
branch = "main"
directory = "."`,
    }];
  }
  return [
    {
      filename: "sandbox.toml",
      language: "toml",
      content: `# sandbox
name = "eks"
terraform_version = "1.11.3"

[public_repo]
repo = "nuonco/aws-eks-sandbox"
branch = "main"
directory = "."

# Override maintenance ClusterRole to allow reading secrets
# (required by Helm charts that use common.secrets.lookup)
[[var_file]]
contents = "./sandbox.tfvars"`,
    },
    {
      filename: "sandbox.tfvars",
      language: "hcl",
      content: MAINTENANCE_RBAC_TFVARS,
    },
  ];
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

// Full maintenance ClusterRole RBAC rules override for aws-eks-sandbox.
// Identical to the upstream defaults in nuonco/aws-eks-sandbox/values/k8s/maintenance_role.yaml
// EXCEPT: "secrets" is added to the core-API get/list/watch rule so that Helm charts
// using common.secrets.lookup (e.g. Bitnami nginx) can read existing secrets during
// sync-and-plan without hitting a 403 Forbidden.
const MAINTENANCE_RBAC_TFVARS = `maintenance_cluster_role_rules_override = [
  # --- cert-manager: mutate ---
  {
    apiGroups = ["cert-manager.io"]
    resources = ["certificates", "certificaterequests", "issuers"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },
  {
    apiGroups = ["cert-manager.io"]
    resources = ["certificates/status"]
    verbs     = ["update"]
  },
  {
    apiGroups = ["acme.cert-manager.io"]
    resources = ["challenges", "orders"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- cert-manager: read ---
  {
    apiGroups = ["cert-manager.io"]
    resources = ["certificates", "certificaterequests", "issuers"]
    verbs     = ["get", "list", "watch"]
  },
  {
    apiGroups = ["acme.cert-manager.io"]
    resources = ["challenges", "orders"]
    verbs     = ["get", "list", "watch"]
  },

  # --- core API: read (pods/exec, proxy, etc.) ---
  # MODIFIED: added "secrets" so Helm lookups (e.g. common.secrets.lookup) work
  {
    apiGroups = [""]
    resources = ["pods/attach", "pods/exec", "pods/portforward", "pods/proxy", "secrets", "services/proxy"]
    verbs     = ["get", "list", "watch"]
  },

  # --- core API: impersonate ---
  {
    apiGroups = [""]
    resources = ["serviceaccounts"]
    verbs     = ["impersonate"]
  },

  # --- core API: mutate pods ---
  {
    apiGroups = [""]
    resources = ["pods", "pods/attach", "pods/exec", "pods/portforward", "pods/proxy"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },
  {
    apiGroups = [""]
    resources = ["pods/eviction"]
    verbs     = ["create"]
  },

  # --- core API: mutate other resources ---
  {
    apiGroups = [""]
    resources = ["configmaps", "events", "persistentvolumeclaims", "replicationcontrollers", "replicationcontrollers/scale", "secrets", "serviceaccounts", "services", "services/proxy"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },
  {
    apiGroups = [""]
    resources = ["serviceaccounts/token"]
    verbs     = ["create"]
  },

  # --- apps: mutate ---
  {
    apiGroups = ["apps"]
    resources = ["daemonsets", "deployments", "deployments/rollback", "deployments/scale", "replicasets", "replicasets/scale", "statefulsets", "statefulsets/scale"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- autoscaling: mutate ---
  {
    apiGroups = ["autoscaling"]
    resources = ["horizontalpodautoscalers"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- batch: mutate ---
  {
    apiGroups = ["batch"]
    resources = ["cronjobs", "jobs"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- extensions: mutate ---
  {
    apiGroups = ["extensions"]
    resources = ["daemonsets", "deployments", "deployments/rollback", "deployments/scale", "ingresses", "networkpolicies", "replicasets", "replicasets/scale", "replicationcontrollers/scale"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- policy: mutate ---
  {
    apiGroups = ["policy"]
    resources = ["poddisruptionbudgets"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- networking: mutate ---
  {
    apiGroups = ["networking.k8s.io"]
    resources = ["ingresses", "networkpolicies"]
    verbs     = ["create", "delete", "deletecollection", "patch", "update"]
  },

  # --- coordination: full ---
  {
    apiGroups = ["coordination.k8s.io"]
    resources = ["leases"]
    verbs     = ["create", "delete", "deletecollection", "get", "list", "patch", "update", "watch"]
  },

  # --- metrics: read ---
  {
    apiGroups = ["metrics.k8s.io"]
    resources = ["pods", "nodes"]
    verbs     = ["get", "list", "watch"]
  },

  # --- kyverno: read ---
  {
    apiGroups = ["kyverno.io"]
    resources = ["cleanuppolicies", "clustercleanuppolicies", "policies", "clusterpolicies"]
    verbs     = ["get", "list", "watch"]
  },
  {
    apiGroups = ["wgpolicyk8s.io"]
    resources = ["policyreports", "clusterpolicyreports"]
    verbs     = ["get", "list", "watch"]
  },
  {
    apiGroups = ["reports.kyverno.io"]
    resources = ["ephemeralreports", "clusterephemeralreports"]
    verbs     = ["get", "list", "watch"]
  },
  {
    apiGroups = ["kyverno.io"]
    resources = ["updaterequests"]
    verbs     = ["get", "list", "watch"]
  },

  # --- core API: read common resources ---
  {
    apiGroups = [""]
    resources = ["configmaps", "endpoints", "persistentvolumeclaims", "persistentvolumeclaims/status", "pods", "replicationcontrollers", "replicationcontrollers/scale", "serviceaccounts", "services", "services/status"]
    verbs     = ["get", "list", "watch"]
  },
  {
    apiGroups = [""]
    resources = ["bindings", "events", "limitranges", "namespaces/status", "pods/log", "pods/status", "replicationcontrollers/status", "resourcequotas", "resourcequotas/status"]
    verbs     = ["get", "list", "watch"]
  },

  # --- core API: namespaces (full) ---
  {
    apiGroups = [""]
    resources = ["namespaces"]
    verbs     = ["*"]
  },

  # --- discovery: read ---
  {
    apiGroups = ["discovery.k8s.io"]
    resources = ["endpointslices"]
    verbs     = ["get", "list", "watch"]
  },

  # --- apps: read ---
  {
    apiGroups = ["apps"]
    resources = ["controllerrevisions", "daemonsets", "daemonsets/status", "deployments", "deployments/scale", "deployments/status", "replicasets", "replicasets/scale", "replicasets/status", "statefulsets", "statefulsets/scale", "statefulsets/status"]
    verbs     = ["get", "list", "watch"]
  },

  # --- autoscaling: read ---
  {
    apiGroups = ["autoscaling"]
    resources = ["horizontalpodautoscalers", "horizontalpodautoscalers/status"]
    verbs     = ["get", "list", "watch"]
  },

  # --- batch: read ---
  {
    apiGroups = ["batch"]
    resources = ["cronjobs", "cronjobs/status", "jobs", "jobs/status"]
    verbs     = ["get", "list", "watch"]
  },

  # --- extensions: read ---
  {
    apiGroups = ["extensions"]
    resources = ["daemonsets", "daemonsets/status", "deployments", "deployments/scale", "deployments/status", "ingresses", "ingresses/status", "networkpolicies", "replicasets", "replicasets/scale", "replicasets/status", "replicationcontrollers/scale"]
    verbs     = ["get", "list", "watch"]
  },

  # --- policy: read ---
  {
    apiGroups = ["policy"]
    resources = ["poddisruptionbudgets", "poddisruptionbudgets/status"]
    verbs     = ["get", "list", "watch"]
  },

  # --- networking: read ---
  {
    apiGroups = ["networking.k8s.io"]
    resources = ["ingresses", "ingresses/status", "networkpolicies"]
    verbs     = ["get", "list", "watch"]
  },

  # --- kyverno: full ---
  {
    apiGroups = ["kyverno.io"]
    resources = ["cleanuppolicies", "clustercleanuppolicies", "policies", "clusterpolicies"]
    verbs     = ["create", "delete", "get", "list", "patch", "update", "watch"]
  },
  {
    apiGroups = ["wgpolicyk8s.io"]
    resources = ["policyreports", "clusterpolicyreports"]
    verbs     = ["create", "delete", "get", "list", "patch", "update", "watch"]
  },
  {
    apiGroups = ["reports.kyverno.io"]
    resources = ["ephemeralreports", "clusterephemeralreports"]
    verbs     = ["create", "delete", "get", "list", "patch", "update", "watch"]
  },
  {
    apiGroups = ["kyverno.io"]
    resources = ["updaterequests"]
    verbs     = ["create", "delete", "get", "list", "patch", "update", "watch"]
  },

  # --- authorization: create ---
  {
    apiGroups = ["authorization.k8s.io"]
    resources = ["localsubjectaccessreviews"]
    verbs     = ["create"]
  },

  # --- rbac: full ---
  {
    apiGroups = ["rbac.authorization.k8s.io"]
    resources = ["rolebindings", "roles"]
    verbs     = ["create", "delete", "deletecollection", "get", "list", "patch", "update", "watch"]
  },
]
`;

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
  bundleChart: boolean,
  configRepo: string,
): GeneratedFile {
  const depLine = depComponentNames.length > 0
    ? `dependencies = [${depComponentNames.map((d) => `"${d}"`).join(", ")}]`
    : "# dependencies = []";

  let repoRef: string;
  let dirRef: string;

  if (bundleChart) {
    repoRef = configRepo || "YOUR_ORG/YOUR_REPO";
    dirRef = `components/chart/${chartName}`;
  } else {
    repoRef = `${org}/${repo}`;
    dirRef = directory;
  }

  const todo = bundleChart && !configRepo
    ? `\n#\n# TODO: Update [public_repo] repo to point to the GitHub repo where you push this config.\n# The chart files are bundled under components/chart/${chartName}/`
    : "";

  return {
    filename: `components/${componentNumber}-${chartName}.toml`,
    language: "toml",
    content: `# helm
name = "${esc(chartName)}"
type = "helm_chart"
chart_name = "${esc(chartName)}"
namespace = "${esc(namespace)}"
storage_driver = "configmap"
${depLine}${todo}

[public_repo]
repo = "${esc(repoRef)}"
directory = "${esc(dirRef)}"
branch = "main"

[[values_file]]
contents = "./values/${esc(chartName)}/values.yaml"`,
  };
}

function inferLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".toml")) return "toml";
  if (lower.endsWith(".tpl")) return "yaml";
  return "plaintext";
}

function generateBundledChartFiles(
  chartName: string,
  chartFiles: ChartFile[],
): GeneratedFile[] {
  return chartFiles.map((cf) => ({
    filename: `components/chart/${chartName}/${cf.relativePath}`,
    language: inferLanguage(cf.relativePath),
    content: cf.content,
  }));
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

/** Navigate a dot-separated path (e.g. "hub.ingress") into a nested object, creating missing keys. */
function navigateToNestedObject(
  obj: Record<string, unknown>,
  dotPath: string,
): Record<string, unknown> | null {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    const rec = current as Record<string, unknown>;
    if (!(part in rec)) rec[part] = {};
    current = rec[part];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? (current as Record<string, unknown>)
    : null;
}

/** Minimal override generator — used as fallback when no original values.yaml is available. */
function generateMinimalValuesFile(
  chartName: string,
  originalValues: string | null,
  infraDeps: string[],
): GeneratedFile {
  const sections: string[] = [];
  const HOSTNAME = "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}";

  sections.push(
    `# Nuon values override for ${chartName}`,
    `# Docs: https://docs.nuon.co/configuration-files`,
  );

  let parsed: Record<string, unknown> = {};
  if (originalValues) {
    try {
      const loaded = yaml.load(originalValues);
      if (loaded && typeof loaded === "object") parsed = loaded as Record<string, unknown>;
    } catch { /* fall through with empty parsed */ }
  }

  const infraKeyMap = findInfraKeys(parsed, infraDeps);
  const disabledKeys = new Set<string>();

  const hasPg = infraDeps.includes("postgresql");
  const hasMysql = infraDeps.some((d) => ["mysql", "mariadb"].includes(d));
  const hasRedis = infraDeps.includes("redis");

  // Disable bundled subcharts using actual key names from values.yaml
  if (hasPg) {
    const keys = infraKeyMap.get("postgresql") || ["postgresql"];
    for (const k of keys) {
      sections.push("", `${k}:`, `  enabled: false`);
      disabledKeys.add(k);
    }
    sections.push(
      "",
      "externalDatabase:",
      `  host: "{{ .nuon.components.rds.outputs.address }}"`,
      `  port: {{ .nuon.components.rds.outputs.db_instance_port }}`,
      `  database: "{{ .nuon.inputs.inputs.db_name }}"`,
      `  existingSecret: "${chartName}-db-credentials"`,
      `  existingSecretPasswordKey: "password"`,
    );
  }

  if (hasMysql) {
    const keys = infraKeyMap.get("mysql") || ["mysql"];
    for (const k of keys) {
      sections.push("", `${k}:`, `  enabled: false`);
      disabledKeys.add(k);
    }
    sections.push(
      "",
      "externalDatabase:",
      `  host: "{{ .nuon.components.rds.outputs.address }}"`,
      `  port: 3306`,
      `  database: "{{ .nuon.inputs.inputs.db_name }}"`,
      `  existingSecret: "${chartName}-db-credentials"`,
      `  existingSecretPasswordKey: "password"`,
    );
  }

  if (hasRedis) {
    const keys = infraKeyMap.get("redis") || ["redis"];
    for (const k of keys) {
      sections.push("", `${k}:`, `  enabled: false`);
      disabledKeys.add(k);
    }
    sections.push(
      "",
      "externalRedis:",
      `  host: "{{ .nuon.components.elasticache.outputs.endpoint }}"`,
      `  port: 6379`,
    );
  }

  // Ingress — match the chart's actual structure
  const ingressInfo = detectIngressStructure(parsed);
  if (ingressInfo?.type === "flat") {
    const parts = ingressInfo.key.split(".");
    const inner = [
      `enabled: true`,
      `hostname: "${HOSTNAME}"`,
      `annotations:`,
      `  external-dns.alpha.kubernetes.io/hostname: "${HOSTNAME}"`,
    ];
    sections.push("", emitNestedYaml(parts, "", 0).replace(/:\s*$/, ":"));
    for (const line of inner) sections.push(`${"  ".repeat(parts.length)}${line}`);
  } else if (ingressInfo?.type === "hosts-array") {
    const parts = ingressInfo.key.split(".");
    const inner = [
      `enabled: true`,
      `hosts:`,
      `  - host: "${HOSTNAME}"`,
      `    paths:`,
      `      - path: /`,
      `        pathType: ImplementationSpecific`,
      `annotations:`,
      `  external-dns.alpha.kubernetes.io/hostname: "${HOSTNAME}"`,
    ];
    sections.push("", emitNestedYaml(parts, "", 0).replace(/:\s*$/, ":"));
    for (const line of inner) sections.push(`${"  ".repeat(parts.length)}${line}`);
  } else {
    sections.push(
      "",
      "ingress:",
      "  enabled: true",
      `  hostname: "${HOSTNAME}"`,
      "  annotations:",
      `    external-dns.alpha.kubernetes.io/hostname: "${HOSTNAME}"`,
    );
  }

  // Password overrides — skip fields under disabled subchart keys
  const passwords = findPasswordPaths(parsed).filter(
    (p) => !disabledKeys.has(p.path[0]),
  );
  if (passwords.length > 0) {
    sections.push("");
    sections.push(emitPasswordOverrides(passwords));
  }

  return {
    filename: `components/values/${chartName}/values.yaml`,
    language: "yaml",
    content: sections.join("\n"),
  };
}

/**
 * Full-file values generator: starts with the complete original values.yaml,
 * applies Nuon modifications in-place, and appends infrastructure wiring.
 * Falls back to minimal generation if no original values are available.
 */
export function generateValuesFile(
  chartName: string,
  originalValues: string | null,
  infraDeps: string[],
): GeneratedFile {
  const HOSTNAME = "{{ .nuon.inputs.inputs.subdomain }}.{{ .nuon.install.sandbox.outputs.nuon_dns.public_domain.name }}";

  // Parse original values
  let parsed: Record<string, unknown> = {};
  if (originalValues) {
    try {
      const loaded = yaml.load(originalValues);
      if (loaded && typeof loaded === "object") parsed = loaded as Record<string, unknown>;
    } catch { /* fall through */ }
  }

  // If no original values available, fall back to minimal generation
  if (Object.keys(parsed).length === 0) {
    return generateMinimalValuesFile(chartName, originalValues, infraDeps);
  }

  // Deep-clone the parsed object for in-place modification
  const modified = JSON.parse(JSON.stringify(parsed)) as Record<string, unknown>;

  const infraKeyMap = findInfraKeys(parsed, infraDeps);
  const disabledKeys = new Set<string>();

  // 1. Disable bundled subcharts
  for (const [, keys] of infraKeyMap) {
    for (const k of keys) {
      if (modified[k] && typeof modified[k] === "object") {
        (modified[k] as Record<string, unknown>).enabled = false;
      } else {
        modified[k] = { enabled: false };
      }
      disabledKeys.add(k);
    }
  }

  // 2. Modify ingress in-place
  const ingressInfo = detectIngressStructure(parsed);
  if (ingressInfo) {
    const ingress = navigateToNestedObject(modified, ingressInfo.key);
    if (ingress) {
      ingress.enabled = true;
      if (ingressInfo.type === "flat") {
        ingress.hostname = HOSTNAME;
      } else {
        // hosts-array: modify first entry or create new
        if (Array.isArray(ingress.hosts) && ingress.hosts.length > 0) {
          const first = ingress.hosts[0];
          if (typeof first === "string") {
            ingress.hosts[0] = HOSTNAME;
          } else if (first && typeof first === "object") {
            (first as Record<string, unknown>).host = HOSTNAME;
          }
        } else {
          ingress.hosts = [
            { host: HOSTNAME, paths: [{ path: "/", pathType: "ImplementationSpecific" }] },
          ];
        }
      }
      // Add external-dns annotation
      if (!ingress.annotations || typeof ingress.annotations !== "object") {
        ingress.annotations = {};
      }
      (ingress.annotations as Record<string, unknown>)["external-dns.alpha.kubernetes.io/hostname"] = HOSTNAME;
    }
  } else {
    // No ingress found in original — add at top level
    modified.ingress = {
      enabled: true,
      hostname: HOSTNAME,
      annotations: { "external-dns.alpha.kubernetes.io/hostname": HOSTNAME },
    };
  }

  // 3. Replace password fields (skip those under disabled subcharts)
  const passwords = findPasswordPaths(parsed).filter((p) => !disabledKeys.has(p.path[0]));
  for (const pw of passwords) {
    let target: Record<string, unknown> = modified;
    let found = true;
    for (let i = 0; i < pw.path.length - 1; i++) {
      const next = target[pw.path[i]];
      if (!next || typeof next !== "object" || Array.isArray(next)) { found = false; break; }
      target = next as Record<string, unknown>;
    }
    if (found) {
      target[pw.path[pw.path.length - 1]] = "{{ .nuon.inputs.inputs.admin_password }}";
    }
  }

  // 4. Remove externalDatabase/externalRedis from clone to avoid duplication
  //    (they'll be appended as commented sections below)
  const hasPg = infraDeps.includes("postgresql");
  const hasMysql = infraDeps.some((d) => ["mysql", "mariadb"].includes(d));
  const hasRedis = infraDeps.includes("redis");
  const hasDb = hasPg || hasMysql;

  if (hasDb) delete modified.externalDatabase;
  if (hasRedis) delete modified.externalRedis;

  // 5. Serialize with yaml.dump()
  const dumpOpts = { lineWidth: -1, noRefs: true, quotingType: '"' as const, forceQuotes: false };
  let yamlContent = yaml.dump(modified, dumpOpts);

  // 5a. Sanitize non-Nuon Go template expressions that survived from the original chart
  yamlContent = sanitizeGoTemplates(yamlContent, parsed);

  // 6. Build final content
  const lines: string[] = [
    `# Nuon values override for ${chartName}`,
    `# Full chart values with Nuon template variables applied in-place.`,
    `# Docs: https://docs.nuon.co/configuration-files`,
    ``,
    yamlContent.trimEnd(),
  ];

  // 7. Append external service blocks
  if (hasDb || hasRedis) {
    lines.push("");
    lines.push("# --- Infrastructure wiring added by byocify ---");
    lines.push("# These connect your app to Nuon-managed cloud services.");
    lines.push("# Adjust field names to match your chart's external service configuration.");
  }

  if (hasPg) {
    lines.push("");
    lines.push(yaml.dump({
      externalDatabase: {
        host: "{{ .nuon.components.rds.outputs.address }}",
        port: "{{ .nuon.components.rds.outputs.db_instance_port }}",
        database: "{{ .nuon.inputs.inputs.db_name }}",
        existingSecret: `${chartName}-db-credentials`,
        existingSecretPasswordKey: "password",
      },
    }, dumpOpts).trimEnd());
  }

  if (hasMysql && !hasPg) {
    lines.push("");
    lines.push(yaml.dump({
      externalDatabase: {
        host: "{{ .nuon.components.rds.outputs.address }}",
        port: 3306,
        database: "{{ .nuon.inputs.inputs.db_name }}",
        existingSecret: `${chartName}-db-credentials`,
        existingSecretPasswordKey: "password",
      },
    }, dumpOpts).trimEnd());
  }

  if (hasRedis) {
    lines.push("");
    lines.push(yaml.dump({
      externalRedis: {
        host: "{{ .nuon.components.elasticache.outputs.endpoint }}",
        port: 6379,
      },
    }, dumpOpts).trimEnd());
  }

  lines.push("");

  return {
    filename: `components/values/${chartName}/values.yaml`,
    language: "yaml",
    content: lines.join("\n"),
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
  chartFiles: ChartFile[] = [],
): GeneratedFile[] {
  const chartName = chart.name || "app";
  const description = chart.description || `Nuon BYOC config for ${chartName}`;
  const ns = options.namespace || chartName;
  const provider = options.cloudProvider || "aws";
  const repoRef = options.configRepo || "YOUR_ORG/YOUR_REPO";
  const [org, repo] = repoFullName.split("/");
  const branch = "main";
  const directory = chart.path || ".";
  const shouldBundle = options.bundleChart && chartFiles.length > 0;

  const autoDetected = detectInfraDeps(chart.dependencies || []);
  const allDeps = [...new Set([...autoDetected, ...options.infraDeps])];

  const files: GeneratedFile[] = [];

  files.push(generateMetadata(chartName, description));
  files.push(generateInputs(chartName, allDeps));

  files.push(...generateSandbox(provider));
  files.push(generateRunner(provider));
  files.push(generateStack(chartName));
  files.push(generateBreakGlass());
  files.push(...generatePermissions());

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
    shouldBundle, repoRef,
  ));

  if (shouldBundle) {
    files.push(...generateBundledChartFiles(chartName, chartFiles));
  }

  files.push(generateValuesFile(chartName, valuesYaml || null, allDeps));

  if (hasDb) {
    files.push(generateDbCredentialsAction(chartName, ns));
  }

  return files;
}

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

export interface ValidationWarning {
  severity: "error" | "warning";
  message: string;
  file?: string;
}

export function validateGeneratedConfig(
  files: GeneratedFile[],
  options: ConfigOptions,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];

  const hasInfraComponents = files.some(
    (f) => f.filename.includes("-rds.toml") ||
           f.filename.includes("-elasticache.toml") ||
           f.filename.includes("-s3.toml"),
  );

  if (!options.configRepo && hasInfraComponents) {
    warnings.push({
      severity: "error",
      message: "Config repository not set — infrastructure component TOML files contain \"YOUR_ORG/YOUR_REPO\" placeholder",
    });
  }

  if (options.bundleChart && !options.configRepo) {
    warnings.push({
      severity: "error",
      message: "Config repository not set — the bundled helm chart component references \"YOUR_ORG/YOUR_REPO\"",
    });
  }

  const helmToml = files.find(
    (f) => f.filename.match(/components\/\d+-.*\.toml$/) && f.content.includes('type = "helm_chart"')
  );
  if (helmToml && !options.bundleChart) {
    const repoMatch = helmToml.content.match(/repo = "(.+)"/);
    const dirMatch = helmToml.content.match(/directory = "(.+)"/);
    if (repoMatch && dirMatch && dirMatch[1] !== ".") {
      warnings.push({
        severity: "warning",
        message: `Chart points at ${repoMatch[1]} subdirectory "${dirMatch[1]}". If this is a monorepo, cloning may time out. Enable "Bundle into config repo" to avoid this.`,
        file: helmToml.filename,
      });
    }
  }

  for (const file of files) {
    if (!options.configRepo && file.content.includes("YOUR_ORG/YOUR_REPO")) continue;
    const todoMatches = file.content.match(/# TODO/g);
    if (todoMatches) {
      warnings.push({
        severity: "warning",
        message: `${todoMatches.length} TODO item${todoMatches.length > 1 ? "s" : ""} to review`,
        file: file.filename,
      });
    }
  }

  if (!options.namespace) {
    warnings.push({
      severity: "warning",
      message: "Namespace not set — will default to chart name",
    });
  }

  const valuesFile = files.find((f) => f.filename.endsWith("values.yaml"));
  if (valuesFile && !valuesFile.content.includes("Full chart values")) {
    warnings.push({
      severity: "warning",
      message: "Values file was generated from scratch — the original values.yaml could not be loaded. This may be caused by GitHub API rate limiting. Try again in a few minutes.",
      file: valuesFile.filename,
    });
  }

  return warnings;
}
