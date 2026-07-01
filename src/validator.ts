import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";

export interface RuleViolation {
  ruleId: string;
  path?: string;
  location?: string; // e.g. "paths./orders.get"
  message: string;
  fix?: string;
}

export interface RuleResult {
  ruleId: string;
  title: string;
  description: string;
  severity: "low" | "medium" | "high";
  status: "pass" | "fail";
  complianceRatio: number; // 0 to 1
  violations: RuleViolation[];
}

export interface CategoryResult {
  id: string;
  name: string;
  score: number;
  rules: RuleResult[];
}

export interface SpecAssessment {
  specName: string;
  score: number;
  categories: CategoryResult[];
  violations: RuleViolation[];
}

// Weights based on severity
const WEIGHTS = {
  high: 5,
  medium: 3,
  low: 1,
};

// Rubric definitions helper to initialize results
const RUBRIC_RULES = [
  {
    id: "DOC-01",
    categoryId: "documentation",
    title: "Operations are documented",
    description: "Every operation defines both a non-empty summary and a description.",
    severity: "medium" as const,
  },
  {
    id: "DOC-02",
    categoryId: "documentation",
    title: "Parameters and schema properties are described",
    description: "Every parameter and every schema property has a description.",
    severity: "low" as const,
  },
  {
    id: "DOC-03",
    categoryId: "documentation",
    title: "Request and response bodies provide examples",
    description: "Request bodies and 2xx responses include at least one example or example value.",
    severity: "low" as const,
  },
  {
    id: "SEC-01",
    categoryId: "security",
    title: "Security schemes are defined",
    description: "The spec declares at least one security scheme under components.securitySchemes.",
    severity: "high" as const,
  },
  {
    id: "SEC-02",
    categoryId: "security",
    title: "Operations require authentication",
    description: "Every operation is covered by a security requirement, either globally (root `security`) or per-operation, unless explicitly marked public.",
    severity: "high" as const,
  },
  {
    id: "SEC-03",
    categoryId: "security",
    title: "Transport and examples are safe",
    description: "All server URLs use HTTPS, and examples contain no real-looking secrets, tokens, or PII.",
    severity: "medium" as const,
  },
  {
    id: "DES-01",
    categoryId: "design",
    title: "Consistent path naming",
    description: "Paths use lowercase, hyphenated, plural-noun resource segments and avoid trailing slashes or verbs in paths.",
    severity: "medium" as const,
  },
  {
    id: "DES-02",
    categoryId: "design",
    title: "Consistent property casing",
    description: "Schema property names use a single consistent casing convention (default: camelCase).",
    severity: "low" as const,
  },
  {
    id: "DES-03",
    categoryId: "design",
    title: "Operations have unique operationIds",
    description: "Every operation defines an operationId, and all operationIds are unique within the spec.",
    severity: "medium" as const,
  },
  {
    id: "CMP-01",
    categoryId: "completeness",
    title: "Error responses are declared",
    description: "Each operation declares at least one 4xx response, and mutating operations (POST/PUT/PATCH/DELETE) declare relevant client and server error responses.",
    severity: "medium" as const,
  },
  {
    id: "CMP-02",
    categoryId: "completeness",
    title: "Responses reference a schema",
    description: "Every 2xx response with a body references a schema (inline or via $ref); no empty content or untyped 'object' placeholders.",
    severity: "high" as const,
  },
  {
    id: "CMP-03",
    categoryId: "completeness",
    title: "Spec metadata is complete",
    description: "info.version, info.title, info.contact, and at least one servers[] entry are present.",
    severity: "low" as const,
  },
];

const CATEGORIES = [
  { id: "documentation", name: "Documentation" },
  { id: "security", name: "Security" },
  { id: "design", name: "Design & Consistency" },
  { id: "completeness", name: "Completeness & Reliability" },
];

/**
 * Assesses an OpenAPI specification content against the quality rubric.
 */
export function assessSpec(specName: string, fileContent: string): SpecAssessment {
  let spec: any;
  try {
    spec = parse(fileContent);
  } catch (err: any) {
    return {
      specName,
      score: 0,
      categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name, score: 0, rules: [] })),
      violations: [
        {
          ruleId: "PARSER_ERROR",
          message: `Failed to parse YAML file: ${err.message}`,
        },
      ],
    };
  }

  if (!spec || typeof spec !== "object") {
    return {
      specName,
      score: 0,
      categories: CATEGORIES.map((c) => ({ id: c.id, name: c.name, score: 0, rules: [] })),
      violations: [
        {
          ruleId: "PARSER_ERROR",
          message: "Parsed OpenAPI spec is empty or not an object.",
        },
      ],
    };
  }

  const allViolations: RuleViolation[] = [];
  const ruleResultsMap = new Map<string, RuleResult>();

  // Initialize rule results map
  for (const rule of RUBRIC_RULES) {
    ruleResultsMap.set(rule.id, {
      ruleId: rule.id,
      title: rule.title,
      description: rule.description,
      severity: rule.severity,
      status: "pass",
      complianceRatio: 1.0,
      violations: [],
    });
  }

  const addViolation = (ruleId: string, location: string | undefined, message: string, fix?: string) => {
    const violation: RuleViolation = { ruleId, location, message, fix };
    allViolations.push(violation);
    ruleResultsMap.get(ruleId)?.violations.push(violation);
  };

  // Pre-collect operations
  const operations: { path: string; method: string; op: any }[] = [];
  if (spec.paths && typeof spec.paths === "object") {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (pathItem && typeof pathItem === "object") {
        for (const [methodKey, operation] of Object.entries(pathItem)) {
          const m = methodKey.toLowerCase();
          if (["get", "post", "put", "delete", "patch", "head", "options", "trace"].includes(m)) {
            operations.push({ path: pathKey, method: m, op: operation });
          }
        }
      }
    }
  }

  // ----------------------------------------------------
  // RULE DOC-01: Operations are documented
  // ----------------------------------------------------
  let undocumentedOpsCount = 0;
  for (const { path: p, method: m, op } of operations) {
    const hasSummary = typeof op.summary === "string" && op.summary.trim().length > 0;
    const hasDesc = typeof op.description === "string" && op.description.trim().length > 0;
    if (!hasSummary || !hasDesc) {
      undocumentedOpsCount++;
      const missing = !hasSummary && !hasDesc ? "summary and description" : !hasSummary ? "summary" : "description";
      addViolation(
        "DOC-01",
        `paths.${p}.${m}`,
        `Operation ${m.toUpperCase()} ${p} is missing ${missing}.`,
        `Add a non-empty summary and description to the ${m.toUpperCase()} ${p} operation.`
      );
    }
  }
  const doc01Ratio = operations.length > 0 ? (operations.length - undocumentedOpsCount) / operations.length : 1.0;
  const doc01Result = ruleResultsMap.get("DOC-01")!;
  doc01Result.complianceRatio = doc01Ratio;
  doc01Result.status = doc01Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE DOC-02: Parameters and schema properties are described
  // ----------------------------------------------------
  let totalParamsChecked = 0;
  let undocumentedParamsCount = 0;
  let totalPropsChecked = 0;
  let undocumentedPropsCount = 0;

  // 1. Check path/operation level parameters
  if (spec.paths && typeof spec.paths === "object") {
    for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
      if (pathItem && typeof pathItem === "object") {
        // Path level parameters
        if (Array.isArray((pathItem as any).parameters)) {
          for (let i = 0; i < (pathItem as any).parameters.length; i++) {
            const param = (pathItem as any).parameters[i];
            if (param && typeof param === "object" && !param.$ref) {
              totalParamsChecked++;
              if (!param.description || typeof param.description !== "string" || param.description.trim().length === 0) {
                undocumentedParamsCount++;
                addViolation(
                  "DOC-02",
                  `paths.${pathKey}.parameters[${i}]`,
                  `Path parameter '${param.name}' is missing a description.`,
                  `Add a description property detailing the purpose of the parameter '${param.name}'.`
                );
              }
            }
          }
        }
        // Operation level parameters
        for (const [methodKey, op] of Object.entries(pathItem)) {
          if (op && typeof op === "object" && Array.isArray((op as any).parameters)) {
            for (let i = 0; i < (op as any).parameters.length; i++) {
              const param = (op as any).parameters[i];
              if (param && typeof param === "object" && !param.$ref) {
                totalParamsChecked++;
                if (!param.description || typeof param.description !== "string" || param.description.trim().length === 0) {
                  undocumentedParamsCount++;
                  addViolation(
                    "DOC-02",
                    `paths.${pathKey}.${methodKey}.parameters[${i}]`,
                    `Parameter '${param.name}' in operation ${methodKey.toUpperCase()} ${pathKey} is missing a description.`,
                    `Add a description property detailing the purpose of the parameter '${param.name}'.`
                  );
                }
              }
            }
          }
        }
      }
    }
  }

  // Helper to traverse and check schema properties
  const checkSchemaProperties = (schema: any, location: string) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.properties && typeof schema.properties === "object") {
      for (const [propName, propVal] of Object.entries(schema.properties)) {
        if (propVal && typeof propVal === "object") {
          totalPropsChecked++;
          const hasDesc = (propVal as any).description && typeof (propVal as any).description === "string" && (propVal as any).description.trim().length > 0;
          const isRef = typeof (propVal as any).$ref === "string";
          if (!hasDesc && !isRef) {
            undocumentedPropsCount++;
            addViolation(
              "DOC-02",
              `${location}.properties.${propName}`,
              `Schema property '${propName}' is missing a description.`,
              `Add a description property explaining the schema property '${propName}'.`
            );
          }
          // Recurse into nested objects
          if ((propVal as any).properties) {
            checkSchemaProperties(propVal, `${location}.properties.${propName}`);
          } else if ((propVal as any).items) {
            checkSchemaProperties((propVal as any).items, `${location}.properties.${propName}.items`);
          }
        }
      }
    }
  };

  // Check component schemas
  if (spec.components?.schemas && typeof spec.components.schemas === "object") {
    for (const [schemaName, schemaVal] of Object.entries(spec.components.schemas)) {
      checkSchemaProperties(schemaVal, `components.schemas.${schemaName}`);
    }
  }

  const doc02Total = totalParamsChecked + totalPropsChecked;
  const doc02Undoc = undocumentedParamsCount + undocumentedPropsCount;
  const doc02Ratio = doc02Total > 0 ? (doc02Total - doc02Undoc) / doc02Total : 1.0;
  const doc02Result = ruleResultsMap.get("DOC-02")!;
  doc02Result.complianceRatio = doc02Ratio;
  doc02Result.status = doc02Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE DOC-03: Request and response bodies provide examples
  // ----------------------------------------------------
  let totalBodiesChecked = 0;
  let bodiesWithoutExampleCount = 0;

  for (const { path: p, method: m, op } of operations) {
    // 1. Check request body
    if (op.requestBody && typeof op.requestBody === "object") {
      const rb = op.requestBody;
      if (rb.content && typeof rb.content === "object") {
        for (const [mediaType, contentObj] of Object.entries(rb.content)) {
          totalBodiesChecked++;
          const hasExample =
            (rb as any).example !== undefined ||
            (rb as any).examples !== undefined ||
            (contentObj as any).example !== undefined ||
            (contentObj as any).examples !== undefined ||
            (contentObj as any).schema?.example !== undefined ||
            (contentObj as any).schema?.examples !== undefined ||
            // Check if properties of the schema have an example
            (contentObj as any).schema?.properties &&
              Object.values((contentObj as any).schema.properties).some((prop: any) => prop && prop.example !== undefined);

          if (!hasExample) {
            bodiesWithoutExampleCount++;
            addViolation(
              "DOC-03",
              `paths.${p}.${m}.requestBody.content.${mediaType}`,
              `Request body for ${mediaType} in ${m.toUpperCase()} ${p} has no example payload.`,
              `Add an 'example' or 'examples' object to the requestBody content for ${mediaType}.`
            );
          }
        }
      }
    }

    // 2. Check 2xx responses
    if (op.responses && typeof op.responses === "object") {
      for (const [statusCode, responseObj] of Object.entries(op.responses)) {
        if (statusCode.startsWith("2") && responseObj && typeof responseObj === "object") {
          const resp = responseObj as any;
          if (resp.content && typeof resp.content === "object") {
            for (const [mediaType, contentObj] of Object.entries(resp.content)) {
              totalBodiesChecked++;
              const hasExample =
                resp.example !== undefined ||
                resp.examples !== undefined ||
                (contentObj as any).example !== undefined ||
                (contentObj as any).examples !== undefined ||
                (contentObj as any).schema?.example !== undefined ||
                (contentObj as any).schema?.examples !== undefined ||
                (contentObj as any).schema?.properties &&
                  Object.values((contentObj as any).schema.properties).some((prop: any) => prop && prop.example !== undefined);

              if (!hasExample) {
                bodiesWithoutExampleCount++;
                addViolation(
                  "DOC-03",
                  `paths.${p}.${m}.responses.${statusCode}.content.${mediaType}`,
                  `Response ${statusCode} body for ${mediaType} in ${m.toUpperCase()} ${p} has no example payload.`,
                  `Add an 'example' or 'examples' object to the responses.${statusCode} content for ${mediaType}.`
                );
              }
            }
          }
        }
      }
    }
  }

  const doc03Ratio = totalBodiesChecked > 0 ? (totalBodiesChecked - bodiesWithoutExampleCount) / totalBodiesChecked : 1.0;
  const doc03Result = ruleResultsMap.get("DOC-03")!;
  doc03Result.complianceRatio = doc03Ratio;
  doc03Result.status = doc03Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE SEC-01: Security schemes are defined
  // ----------------------------------------------------
  const securitySchemes = spec.components?.securitySchemes;
  const sec01HasSchemes = securitySchemes && typeof securitySchemes === "object" && Object.keys(securitySchemes).length > 0;
  const sec01Ratio = sec01HasSchemes ? 1.0 : 0.0;
  if (!sec01HasSchemes) {
    addViolation(
      "SEC-01",
      "components.securitySchemes",
      "The spec declares no security schemes under components.securitySchemes.",
      "Define security scheme details (e.g. bearerAuth, apiKey) under components.securitySchemes."
    );
  }
  const sec01Result = ruleResultsMap.get("SEC-01")!;
  sec01Result.complianceRatio = sec01Ratio;
  sec01Result.status = sec01Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE SEC-02: Operations require authentication
  // ----------------------------------------------------
  let unsecuredOpsCount = 0;
  const globalSecurity = Array.isArray(spec.security);

  for (const { path: p, method: m, op } of operations) {
    const hasLocalSecurity = Array.isArray(op.security);
    if (!hasLocalSecurity && !globalSecurity) {
      unsecuredOpsCount++;
      addViolation(
        "SEC-02",
        `paths.${p}.${m}`,
        `Operation ${m.toUpperCase()} ${p} is not covered by any global or operation-level security requirements.`,
        `Apply security requirements to the operation using the 'security' tag, or define a global 'security' block in the root, or mark it public by adding an empty local 'security: []' array.`
      );
    }
  }
  const sec02Ratio = operations.length > 0 ? (operations.length - unsecuredOpsCount) / operations.length : 1.0;
  const sec02Result = ruleResultsMap.get("SEC-02")!;
  sec02Result.complianceRatio = sec02Ratio;
  sec02Result.status = sec02Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE SEC-03: Transport and examples are safe
  // ----------------------------------------------------
  let totalServersChecked = 0;
  let unsafeServersCount = 0;
  let unsafeExamplesCount = 0;

  // 1. Check server URLs for HTTPS
  if (Array.isArray(spec.servers)) {
    for (let i = 0; i < spec.servers.length; i++) {
      const server = spec.servers[i];
      if (server && typeof server === "object" && typeof server.url === "string") {
        totalServersChecked++;
        if (!server.url.toLowerCase().startsWith("https:")) {
          unsafeServersCount++;
          addViolation(
            "SEC-03",
            `servers[${i}]`,
            `Server URL '${server.url}' does not use HTTPS.`,
            `Update the server URL to use secure 'https://' protocol.`
          );
        }
      }
    }
  }

  // 2. Check examples for JWT tokens, private keys, or passwords
  const jwtRegex = /ey[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]{10,}\.[a-zA-Z0-9_\-]+/;
  const keyHeaderRegex = /(?:BEGIN|END) (?:RSA )?(?:PRIVATE|PUBLIC) KEY/;
  // Check string values recursively in an example object
  const inspectExampleValue = (val: any, location: string) => {
    if (typeof val === "string") {
      if (jwtRegex.test(val)) {
        unsafeExamplesCount++;
        addViolation(
          "SEC-03",
          location,
          `Example value appears to contain a real JWT token.`,
          `Replace the token in the example with a safe mock placeholder.`
        );
      } else if (keyHeaderRegex.test(val)) {
        unsafeExamplesCount++;
        addViolation(
          "SEC-03",
          location,
          `Example value contains cryptographic key headers.`,
          `Replace the cryptographic key with a generic mock string.`
        );
      }
    } else if (val && typeof val === "object") {
      for (const [k, v] of Object.entries(val)) {
        inspectExampleValue(v, `${location}.${k}`);
      }
    }
  };

  // Collect examples from spec to inspect
  const checkExamplesTraversal = (obj: any, location: string) => {
    if (!obj || typeof obj !== "object") return;
    if (obj.example !== undefined) {
      inspectExampleValue(obj.example, `${location}.example`);
    }
    if (obj.examples && typeof obj.examples === "object") {
      for (const [exName, exVal] of Object.entries(obj.examples)) {
        if (exVal && typeof exVal === "object" && (exVal as any).value !== undefined) {
          inspectExampleValue((exVal as any).value, `${location}.examples.${exName}.value`);
        } else {
          inspectExampleValue(exVal, `${location}.examples.${exName}`);
        }
      }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (k !== "example" && k !== "examples" && v && typeof v === "object") {
        checkExamplesTraversal(v, `${location}.${k}`);
      }
    }
  };
  checkExamplesTraversal(spec, "root");

  const sec03Total = totalServersChecked + unsafeExamplesCount; // Let's base on total checks
  const sec03Unsafe = unsafeServersCount + unsafeExamplesCount;
  const sec03Ratio = sec03Total > 0 ? (sec03Total - sec03Unsafe) / sec03Total : 1.0;
  const sec03Result = ruleResultsMap.get("SEC-03")!;
  sec03Result.complianceRatio = sec03Ratio;
  sec03Result.status = sec03Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE DES-01: Consistent path naming
  // ----------------------------------------------------
  let inconsistentPathsCount = 0;
  const commonVerbs = ["get", "create", "delete", "update", "post", "put", "add", "remove", "search"];
  const commonSingularNouns = ["order", "customer", "item", "user", "payment", "refund", "payout", "shipment", "notification", "catalog", "ticket", "role", "address"];

  if (spec.paths && typeof spec.paths === "object") {
    for (const pathKey of Object.keys(spec.paths)) {
      let isPathInconsistent = false;
      const issues: string[] = [];

      // 1. Avoid trailing slash
      if (pathKey.endsWith("/") && pathKey !== "/") {
        isPathInconsistent = true;
        issues.push("contains a trailing slash");
      }

      // 2. Check path segments
      const segments = pathKey.split("/").filter((s) => s.length > 0);
      for (const seg of segments) {
        // Skip path parameters
        if (seg.startsWith("{") && seg.endsWith("}")) {
          continue;
        }
        // Check casing and underscores
        if (/[A-Z]/.test(seg)) {
          isPathInconsistent = true;
          issues.push(`segment '${seg}' contains uppercase letters`);
        }
        if (seg.includes("_")) {
          isPathInconsistent = true;
          issues.push(`segment '${seg}' uses underscores instead of hyphens`);
        }
        // Check verbs
        const lowerSeg = seg.toLowerCase();
        for (const verb of commonVerbs) {
          if (lowerSeg.startsWith(verb) || lowerSeg.endsWith(verb)) {
            isPathInconsistent = true;
            issues.push(`segment '${seg}' contains the verb '${verb}'`);
          }
        }
        // Check singular nouns
        if (commonSingularNouns.includes(lowerSeg)) {
          isPathInconsistent = true;
          issues.push(`segment '${seg}' is a singular noun (should use plural form)`);
        }
      }

      if (isPathInconsistent) {
        inconsistentPathsCount++;
        addViolation(
          "DES-01",
          `paths.${pathKey}`,
          `Path '${pathKey}' does not follow REST naming conventions: ${issues.join("; ")}.`,
          `Rewrite path '${pathKey}' in lowercase, using hyphens (kebab-case) and plural nouns, removing verbs or trailing slashes (e.g. rename /getOrder/ to /orders).`
        );
      }
    }
  }

  const des01TotalPaths = spec.paths ? Object.keys(spec.paths).length : 0;
  const des01Ratio = des01TotalPaths > 0 ? (des01TotalPaths - inconsistentPathsCount) / des01TotalPaths : 1.0;
  const des01Result = ruleResultsMap.get("DES-01")!;
  des01Result.complianceRatio = des01Ratio;
  des01Result.status = des01Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE DES-02: Consistent property casing
  // ----------------------------------------------------
  let totalPropertiesChecked = 0;
  let inconsistentCasingCount = 0;
  const camelCaseRegex = /^[a-z][a-zA-Z0-9]*$/;

  const checkPropertyCasing = (schema: any, location: string) => {
    if (!schema || typeof schema !== "object") return;
    if (schema.properties && typeof schema.properties === "object") {
      for (const [propName, propVal] of Object.entries(schema.properties)) {
        totalPropertiesChecked++;
        if (!camelCaseRegex.test(propName)) {
          inconsistentCasingCount++;
          addViolation(
            "DES-02",
            `${location}.properties.${propName}`,
            `Schema property '${propName}' does not use camelCase.`,
            `Rename the property '${propName}' to camelCase (e.g., '${propName.replace(/_([a-z])/g, (g) => g[1].toUpperCase())}').`
          );
        }
        // Recurse
        if (propVal && typeof propVal === "object") {
          if ((propVal as any).properties) {
            checkPropertyCasing(propVal, `${location}.properties.${propName}`);
          } else if ((propVal as any).items) {
            checkPropertyCasing((propVal as any).items, `${location}.properties.${propName}.items`);
          }
        }
      }
    }
  };

  if (spec.components?.schemas && typeof spec.components.schemas === "object") {
    for (const [schemaName, schemaVal] of Object.entries(spec.components.schemas)) {
      checkPropertyCasing(schemaVal, `components.schemas.${schemaName}`);
    }
  }

  const des02Ratio = totalPropertiesChecked > 0 ? (totalPropertiesChecked - inconsistentCasingCount) / totalPropertiesChecked : 1.0;
  const des02Result = ruleResultsMap.get("DES-02")!;
  des02Result.complianceRatio = des02Ratio;
  des02Result.status = des02Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE DES-03: Operations have unique operationIds
  // ----------------------------------------------------
  let invalidOpIdCount = 0;
  const seenOpIds = new Set<string>();

  for (const { path: p, method: m, op } of operations) {
    const opId = op.operationId;
    if (!opId || typeof opId !== "string" || opId.trim().length === 0) {
      invalidOpIdCount++;
      addViolation(
        "DES-03",
        `paths.${p}.${m}`,
        `Operation ${m.toUpperCase()} ${p} is missing an operationId.`,
        `Define a unique 'operationId' for the ${m.toUpperCase()} ${p} operation.`
      );
    } else if (seenOpIds.has(opId)) {
      invalidOpIdCount++;
      addViolation(
        "DES-03",
        `paths.${p}.${m}`,
        `Operation ${m.toUpperCase()} ${p} shares a duplicate operationId '${opId}'.`,
        `Change the duplicate operationId '${opId}' in ${m.toUpperCase()} ${p} to a unique value.`
      );
    } else {
      seenOpIds.add(opId);
    }
  }

  const des03Ratio = operations.length > 0 ? (operations.length - invalidOpIdCount) / operations.length : 1.0;
  const des03Result = ruleResultsMap.get("DES-03")!;
  des03Result.complianceRatio = des03Ratio;
  des03Result.status = des03Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE CMP-01: Error responses are declared
  // ----------------------------------------------------
  let missingErrorResponsesCount = 0;

  for (const { path: p, method: m, op } of operations) {
    const responses = op.responses || {};
    const statusCodes = Object.keys(responses);
    const has4xx = statusCodes.some((code) => code.startsWith("4") || code === "default" || code.toLowerCase() === "4xx");

    if (["post", "put", "patch", "delete"].includes(m)) {
      // Mutating: needs 4xx and 5xx
      const has5xx = statusCodes.some((code) => code.startsWith("5") || code === "default" || code.toLowerCase() === "5xx");
      if (!has4xx || !has5xx) {
        missingErrorResponsesCount++;
        const missing = !has4xx && !has5xx ? "4xx client and 5xx server error responses" : !has4xx ? "4xx client error response" : "5xx server error response";
        addViolation(
          "CMP-01",
          `paths.${p}.${m}.responses`,
          `Mutating operation ${m.toUpperCase()} ${p} is missing ${missing}.`,
          `Declare at least one client error response (e.g. 400 Bad Request) and one server error response (e.g. 500 Internal Server Error).`
        );
      }
    } else {
      // Non-mutating: needs at least 4xx
      if (!has4xx) {
        missingErrorResponsesCount++;
        addViolation(
          "CMP-01",
          `paths.${p}.${m}.responses`,
          `Operation ${m.toUpperCase()} ${p} has no 4xx client error responses.`,
          `Declare at least one client error response (e.g., 401 Unauthorized or 404 Not Found) representing potential client failures.`
        );
      }
    }
  }

  const cmp01Ratio = operations.length > 0 ? (operations.length - missingErrorResponsesCount) / operations.length : 1.0;
  const cmp01Result = ruleResultsMap.get("CMP-01")!;
  cmp01Result.complianceRatio = cmp01Ratio;
  cmp01Result.status = cmp01Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE CMP-02: Responses reference a schema
  // ----------------------------------------------------
  let totalResponsesWithBody = 0;
  let responseBodyMissingSchemaCount = 0;

  for (const { path: p, method: m, op } of operations) {
    if (op.responses && typeof op.responses === "object") {
      for (const [statusCode, responseObj] of Object.entries(op.responses)) {
        if (statusCode.startsWith("2") && responseObj && typeof responseObj === "object") {
          const content = (responseObj as any).content;
          if (content && typeof content === "object") {
            for (const [mediaType, contentObj] of Object.entries(content)) {
              totalResponsesWithBody++;
              const schema = (contentObj as any).schema;
              const hasRef = schema && (schema.$ref || schema.type || schema.properties || schema.allOf || schema.anyOf || schema.oneOf);
              const isEmptyObject = schema && schema.type === "object" && !schema.properties && !schema.additionalProperties;

              if (!schema || !hasRef || isEmptyObject) {
                responseBodyMissingSchemaCount++;
                addViolation(
                  "CMP-02",
                  `paths.${p}.${m}.responses.${statusCode}.content.${mediaType}`,
                  `Response ${statusCode} media type ${mediaType} has a body but is missing a structured schema (or uses an empty/untyped object).`,
                  `Add a valid schema structure or $ref schema reference to the response code ${statusCode} for ${mediaType}.`
                );
              }
            }
          }
        }
      }
    }
  }

  const cmp02Ratio = totalResponsesWithBody > 0 ? (totalResponsesWithBody - responseBodyMissingSchemaCount) / totalResponsesWithBody : 1.0;
  const cmp02Result = ruleResultsMap.get("CMP-02")!;
  cmp02Result.complianceRatio = cmp02Ratio;
  cmp02Result.status = cmp02Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // RULE CMP-03: Spec metadata is complete
  // ----------------------------------------------------
  let metadataScore = 0;
  const info = spec.info || {};

  const hasTitle = typeof info.title === "string" && info.title.trim().length > 0;
  const hasVersion = typeof info.version === "string" && info.version.trim().length > 0;
  const hasContact = info.contact && typeof info.contact === "object" && Object.keys(info.contact).length > 0;
  const hasServers = Array.isArray(spec.servers) && spec.servers.length > 0;

  if (hasTitle) metadataScore++;
  else addViolation("CMP-03", "info.title", "Spec metadata is missing 'info.title'.", "Add 'info.title' in the info section.");

  if (hasVersion) metadataScore++;
  else addViolation("CMP-03", "info.version", "Spec metadata is missing 'info.version'.", "Add 'info.version' in the info section.");

  if (hasContact) metadataScore++;
  else addViolation("CMP-03", "info.contact", "Spec metadata is missing 'info.contact'.", "Add a contact object (e.g. name/email) in the 'info.contact' field.");

  if (hasServers) metadataScore++;
  else addViolation("CMP-03", "servers", "Spec metadata is missing at least one entry in 'servers[]'.", "Add a list of server URLs in the 'servers' block.");

  const cmp03Ratio = metadataScore / 4;
  const cmp03Result = ruleResultsMap.get("CMP-03")!;
  cmp03Result.complianceRatio = cmp03Ratio;
  cmp03Result.status = cmp03Ratio === 1.0 ? "pass" : "fail";

  // ----------------------------------------------------
  // SCORE CALCULATION
  // ----------------------------------------------------
  let totalWeights = 0;
  let weightedRatioSum = 0;

  for (const rule of RUBRIC_RULES) {
    const result = ruleResultsMap.get(rule.id)!;
    const weight = WEIGHTS[rule.severity];
    totalWeights += weight;
    weightedRatioSum += result.complianceRatio * weight;
  }

  const overallScore = totalWeights > 0 ? Math.round((weightedRatioSum / totalWeights) * 100) : 100;

  // Group into categories
  const categoriesMap = new Map<string, RuleResult[]>();
  for (const rule of RUBRIC_RULES) {
    const result = ruleResultsMap.get(rule.id)!;
    if (!categoriesMap.has(rule.categoryId)) {
      categoriesMap.set(rule.categoryId, []);
    }
    categoriesMap.get(rule.categoryId)!.push(result);
  }

  const categories: CategoryResult[] = CATEGORIES.map((c) => {
    const rules = categoriesMap.get(c.id) || [];
    let catWeights = 0;
    let catWeightedRatioSum = 0;
    for (const r of rules) {
      const w = WEIGHTS[r.severity];
      catWeights += w;
      catWeightedRatioSum += r.complianceRatio * w;
    }
    const catScore = catWeights > 0 ? Math.round((catWeightedRatioSum / catWeights) * 100) : 100;
    return {
      id: c.id,
      name: c.name,
      score: catScore,
      rules,
    };
  });

  return {
    specName,
    score: overallScore,
    categories,
    violations: allViolations,
  };
}

/**
 * Evaluates all spec files in a directory against the rubric.
 */
export function assessAllSpecs(specsDir: string): SpecAssessment[] {
  const assessments: SpecAssessment[] = [];
  if (!fs.existsSync(specsDir)) return assessments;

  const files = fs.readdirSync(specsDir);
  for (const file of files) {
    if (file.endsWith(".yaml") || file.endsWith(".yml") || file.endsWith(".json")) {
      const filePath = path.join(specsDir, file);
      const fileContent = fs.readFileSync(filePath, "utf-8");
      const specName = path.basename(file, path.extname(file)); // remove extension
      assessments.push(assessSpec(specName, fileContent));
    }
  }

  return assessments;
}
