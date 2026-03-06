import { describe, it, expect } from "vitest";
import { sanitizeGoTemplates, generateValuesFile } from "../lib/nuon";

describe("sanitizeGoTemplates", () => {
  const valuesObj = {
    metrics: { service: { port: 9113 }, enabled: false },
    prefix: "my-app",
    suffix: "prod",
    extraLabels: { app: "nginx" },
    nested: { deep: { obj: { key: "val" } } },
    image: { tag: "1.25.0" },
  };

  it("preserves .nuon.* expressions", () => {
    const input = 'host: "{{ .nuon.components.rds.outputs.address }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe(input);
  });

  it("preserves index .nuon.* expressions", () => {
    const input =
      'subnet: "{{ index .nuon.install.sandbox.outputs.vpc.private_subnet_ids 0 }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe(input);
  });

  it("resolves .Values.* to scalar values", () => {
    const input = 'port: "{{ .Values.metrics.service.port }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('port: "9113"');
  });

  it("resolves .Values.* boolean values", () => {
    const input = 'enabled: "{{ .Values.metrics.enabled }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('enabled: "false"');
  });

  it("resolves .Values.* string values", () => {
    const input = 'tag: "{{ .Values.image.tag }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('tag: "1.25.0"');
  });

  it("handles .Values.* with | default fallback when value exists", () => {
    const input = 'port: "{{ .Values.metrics.service.port | default \"8080\" }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('port: "9113"');
  });

  it("handles .Values.* with | default fallback when value missing", () => {
    const input = 'foo: "{{ .Values.nonexistent | default \"fallback\" }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('foo: "fallback"');
  });

  it("handles .Values.* with | default single-quoted fallback", () => {
    const input = "bar: \"{{ .Values.nonexistent | default 'backup' }}\"";
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('bar: "backup"');
  });

  it("strips .Chart.* expressions", () => {
    const input = 'tag: "{{ .Chart.AppVersion }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('tag: ""');
  });

  it("strips .Release.* expressions", () => {
    const input = 'name: "{{ .Release.Name }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('name: ""');
  });

  it("strips include expressions", () => {
    const input = 'name: "{{ include \"nginx.fullname\" . }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('name: ""');
  });

  it("strips template expressions", () => {
    const input = 'labels: "{{ template \"nginx.labels\" . }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('labels: ""');
  });

  it("handles {{- whitespace-trimming variants", () => {
    const input = 'port: "{{- .Values.metrics.service.port -}}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('port: "9113"');
  });

  it("handles multiple expressions in one string", () => {
    const input = 'combined: "{{ .Values.prefix }}-{{ .Values.suffix }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('combined: "my-app-prod"');
  });

  it("replaces unresolvable .Values.* with empty string", () => {
    const input = 'missing: "{{ .Values.does.not.exist }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('missing: ""');
  });

  it("replaces .Values.* resolving to object with empty string", () => {
    const input = 'obj: "{{ .Values.metrics }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('obj: ""');
  });

  it("handles index .Values.* expressions", () => {
    const input = 'label: "{{ index .Values.extraLabels \"app\" }}"';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe('label: "nginx"');
  });

  it("leaves plain text without templates unchanged", () => {
    const input = "port: 8080\nhost: example.com";
    expect(sanitizeGoTemplates(input, valuesObj)).toBe(input);
  });

  it("strips if/else/end control flow", () => {
    const input = '{{ if .Values.metrics.enabled }}yes{{ else }}no{{ end }}';
    expect(sanitizeGoTemplates(input, valuesObj)).toBe("yesno");
  });
});

describe("generateValuesFile Go template sanitization", () => {
  it("resolves .Values references and strips non-Nuon templates", () => {
    const valuesYaml = `
metrics:
  service:
    port: 9113
  annotations:
    prometheus.io/port: "{{ .Values.metrics.service.port }}"
    prometheus.io/scrape: "true"
image:
  tag: "{{ .Chart.AppVersion }}"
`;
    const result = generateValuesFile("nginx", valuesYaml, []);

    // .Values.metrics.service.port should be resolved to 9113
    expect(result.content).toContain("9113");
    expect(result.content).not.toContain(".Values.metrics.service.port");

    // .Chart.AppVersion should be stripped
    expect(result.content).not.toContain(".Chart.AppVersion");

    // Nuon expressions injected by the generator should survive
    expect(result.content).toContain(".nuon.");
  });

  it("preserves Nuon templates while stripping Helm templates", () => {
    const valuesYaml = `
service:
  port: 80
annotations:
  example: "{{ .Release.Name }}-svc"
`;
    const result = generateValuesFile("myapp", valuesYaml, []);

    // .Release.Name should be stripped
    expect(result.content).not.toContain(".Release.Name");

    // Nuon hostname template should be present
    expect(result.content).toContain(".nuon.inputs.inputs.subdomain");
  });
});
