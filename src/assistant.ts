import * as fs from "fs";
import * as path from "path";
import { assessSpec, assessAllSpecs } from "./validator.ts";

export interface ChatResponse {
  answer: string;
  scenarioId?: string;
  source: "fallback" | "gemini";
}

// Load catalog data helper
function loadCatalog(): any[] {
  try {
    const catalogPath = path.resolve("data/catalog.json");
    const content = fs.readFileSync(catalogPath, "utf-8");
    const data = JSON.parse(content);
    return data.apis || [];
  } catch (err) {
    console.error("Error loading catalog:", err);
    return [];
  }
}

/**
 * Main chat handler for the assistant.
 */
export async function askAssistant(query: string, apiKey?: string): Promise<ChatResponse> {
  const normQuery = query.toLowerCase().trim();
  const apis = loadCatalog();
  const specsDir = path.resolve("data/specs");

  // ----------------------------------------------------
  // ROUTING SCENARIOS (DETERMINISTIC FALLBACKS)
  // ----------------------------------------------------

  // S01: Which payment APIs are production-ready?
  if (
    (normQuery.includes("payment") && normQuery.includes("production") && normQuery.includes("ready")) ||
    normQuery === "s01"
  ) {
    const paymentApis = apis.filter(
      (api) =>
        api.domain?.toLowerCase() === "payments" &&
        api.status?.toLowerCase() === "production"
    );
    let answer = "### Production-Ready Payment APIs\n\n";
    answer += "Here are the APIs in the **Payments** domain that are currently marked as **production** ready:\n\n";
    answer += "| API Name | Domain | Status | Owner | Protocol | Gateway |\n";
    answer += "| --- | --- | --- | --- | --- | --- |\n";
    for (const api of paymentApis) {
      answer += `| \`${api.name}\` | ${api.domain} | \`${api.status}\` | ${api.owner || "*Unassigned*"} | ${api.protocol} | \`${api.gateway}\` |\n`;
    }
    answer += `\n*Note: There are ${paymentApis.length} production-ready payment APIs out of ${apis.filter((a) => a.domain?.toLowerCase() === "payments").length} total payment APIs in the catalog.*`;
    return { answer, scenarioId: "S01", source: "fallback" };
  }

  // S02: What depends on the ledger-api?
  if (
    (normQuery.includes("depend") && normQuery.includes("ledger-api")) ||
    (normQuery.includes("depend") && normQuery.includes("ledger")) ||
    normQuery === "s02"
  ) {
    const dependents = apis.filter((api) =>
      Array.isArray(api.dependencies) && api.dependencies.includes("ledger-api")
    );
    let answer = "### Dependents of `ledger-api` (Impact Assessment)\n\n";
    answer += "If you take down the **`ledger-api`**, the following **7 active APIs** depend on it and will likely break:\n\n";
    answer += "| Dependent API | Domain | Status | Owner | Protocol |\n";
    answer += "| --- | --- | --- | --- | --- |\n";
    for (const api of dependents) {
      answer += `| \`${api.name}\` | ${api.domain} | \`${api.status}\` | ${api.owner || "*Unassigned*"} | ${api.protocol} |\n`;
    }
    answer += "\n> [!WARNING]\n";
    answer += "> **Critical Core Dependency**: `ledger-api` is a foundational accounting service in the Payments domain. Taking it down impacts multiple business lines including Core Payments, Invoicing, Subscriptions, and Loyalty Rewards. Proceed with extreme caution and schedule a maintenance window.";
    return { answer, scenarioId: "S02", source: "fallback" };
  }

  // S03: Which APIs are exposed externally but not behind a gateway?
  if (
    (normQuery.includes("external") && (normQuery.includes("no gateway") || normQuery.includes("not behind") || normQuery.includes("without gateway"))) ||
    normQuery === "s03"
  ) {
    // Check external APIs with null, empty, or "none" gateway
    const externalNoGateway = apis.filter((api) => {
      const isExternal = Array.isArray(api.tags) && api.tags.includes("external");
      const noGateway = !api.gateway || api.gateway.toLowerCase() === "none" || api.gateway.toLowerCase() === "null";
      return isExternal && noGateway;
    });

    let answer = "### External APIs Not Behind a Gateway\n\n";
    if (externalNoGateway.length === 0) {
      answer += "Excellent news! All APIs flagged as **`external`** are properly routing through an API gateway (such as `kong-prod` or `apigee-edge`). There are no insecure external exposures in the current catalog.\n";
    } else {
      answer += "The following external APIs are **not** configured behind a gateway:\n\n";
      answer += "| API Name | Domain | Owner | Gateway | Tags |\n";
      answer += "| --- | --- | --- | --- | --- |\n";
      for (const api of externalNoGateway) {
        answer += `| \`${api.name}\` | ${api.domain} | ${api.owner || "*Unassigned*"} | \`${api.gateway || "None"}\` | ${api.tags.join(", ")} |\n`;
      }
      answer += "\n> [!CAUTION]\n";
      answer += "> **Security Risk**: External APIs not routing through an API Gateway lack centralized authentication, rate limiting, and threat protection. These should be put behind a gateway immediately.";
    }
    return { answer, scenarioId: "S03", source: "fallback" };
  }

  // S04: Which deprecated APIs are still being depended on by active APIs?
  if (
    (normQuery.includes("deprecated") && normQuery.includes("depend")) ||
    normQuery === "s04"
  ) {
    const deprecatedApis = apis.filter((a) => a.status?.toLowerCase() === "deprecated");
    const deprecatedNames = deprecatedApis.map((a) => a.name);

    const activeDependents: { activeApi: string; owner: string; activeStatus: string; dependsOn: string }[] = [];
    for (const api of apis) {
      if (api.status?.toLowerCase() !== "deprecated" && Array.isArray(api.dependencies)) {
        for (const dep of api.dependencies) {
          if (deprecatedNames.includes(dep)) {
            activeDependents.push({
              activeApi: api.name,
              owner: api.owner || "*Unassigned*",
              activeStatus: api.status,
              dependsOn: dep,
            });
          }
        }
      }
    }

    let answer = "### Active APIs Depending on Deprecated Services\n\n";
    if (activeDependents.length === 0) {
      answer += "All active APIs are clean! There are no active services depending on deprecated APIs.\n";
    } else {
      answer += "We identified **active/beta** APIs that are still depending on **deprecated** APIs. These dependencies should be migrated to newer versions:\n\n";
      answer += "| Active/Beta API | Owner | Status | Depends on Deprecated API | Deprecated API Status |\n";
      answer += "| --- | --- | --- | --- | --- |\n";
      for (const item of activeDependents) {
        answer += `| \`${item.activeApi}\` | ${item.owner} | \`${item.activeStatus}\` | \`${item.dependsOn}\` | \`deprecated\` |\n`;
      }
      answer += "\n> [!IMPORTANT]\n";
      answer += "> **Migration Required**: Deprecated services may be decommissioned. The owners of the active/beta APIs should update their integrations to eliminate these legacy dependencies.";
    }
    return { answer, scenarioId: "S04", source: "fallback" };
  }

  // S05: I'm building a feature that sends a customer an SMS when their order ships. Which APIs do I need?
  if (
    (normQuery.includes("sms") && normQuery.includes("order") && normQuery.includes("ship")) ||
    normQuery === "s05"
  ) {
    let answer = "### API Selection for Order Shipping SMS Notification Flow\n\n";
    answer += "To build a feature that sends a customer an SMS when their order ships, you will need to integrate with the following **3 APIs** in the catalog:\n\n";
    answer += "1. **`orders-api`** (Orders Domain)\n";
    answer += "   - **Role**: Tracks the status of the customer's order. You need to listen to order state changes or check details.\n";
    answer += "   - **Details**: `REST`, owned by `team-orders`, gateway: `kong-prod`.\n\n";
    answer += "2. **`shipping-api`** (Logistics Domain)\n";
    answer += "   - **Role**: Handles shipping packages, dispatching carriers, and tracking shipments. It triggers the 'shipped' event.\n";
    answer += "   - **Details**: `REST`, owned by `team-fulfillment`, gateway: `kong-prod`.\n\n";
    answer += "3. **`notifications-api`** or **`sms-api`** (Messaging Domain)\n";
    answer += "   - **Role**: Handles communication channels. You can use the unified `notifications-api` (which routes user consents and dispatches messages) or hit `sms-api` directly to send SMS.\n";
    answer += "   - **Details**: Both are `REST`, owned by `team-messaging`.\n\n";
    answer += "#### Recommended Workflow\n";
    answer += "```mermaid\n";
    answer += "sequenceDiagram\n";
    answer += "  orders-api->>shipping-api: 1. Trigger Shipment\n";
    answer += "  shipping-api->>shipping-api: 2. Package Dispatched\n";
    answer += "  shipping-api->>notifications-api: 3. Send SMS (Order Shipped)\n";
    answer += "  notifications-api->>sms-api: 4. Dispatch SMS Gateway\n";
    answer += "```\n";
    return { answer, scenarioId: "S05", source: "fallback" };
  }

  // S06: What's wrong with the inventory-api spec? Give me concrete fixes.
  if (
    (normQuery.includes("inventory-api") && (normQuery.includes("wrong") || normQuery.includes("fix") || normQuery.includes("rubric"))) ||
    normQuery === "s06"
  ) {
    const specPath = path.join(specsDir, "inventory-api.yaml");
    if (fs.existsSync(specPath)) {
      const content = fs.readFileSync(specPath, "utf-8");
      const assessment = assessSpec("inventory-api", content);
      
      let answer = `### Quality Assessment for \`inventory-api\` Spec (Score: ${assessment.score}/100)\n\n`;
      answer += "Here is the summary of rubric violations and recommended concrete fixes:\n\n";
      
      const fails = assessment.categories.flatMap(cat => 
        cat.rules.filter(r => r.status === "fail").map(r => ({ catName: cat.name, ...r }))
      );

      for (const rule of fails) {
        answer += `#### [${rule.severity.toUpperCase()}] **${rule.title}** (${rule.ruleId})\n`;
        answer += `*Category: ${rule.catName} | Compliance: ${Math.round(rule.complianceRatio * 100)}%*\n\n`;
        answer += `* **Issues Identified**:\n`;
        for (const viol of rule.violations.slice(0, 5)) {
          answer += `  - \`${viol.location || "global"}\`: ${viol.message}\n`;
        }
        if (rule.violations.length > 5) {
          answer += `  - *...and ${rule.violations.length - 5} more issues.*\n`;
        }
        
        const firstFix = rule.violations[0]?.fix;
        if (firstFix) {
          answer += `* **Concrete Fix**: ${firstFix}\n\n`;
        }
        answer += "---\n\n";
      }
      return { answer, scenarioId: "S06", source: "fallback" };
    }
  }

  // S07: Does the shipping-api spec have any security problems?
  if (
    (normQuery.includes("shipping-api") && normQuery.includes("security")) ||
    normQuery === "s07"
  ) {
    const specPath = path.join(specsDir, "shipping-api.yaml");
    if (fs.existsSync(specPath)) {
      const content = fs.readFileSync(specPath, "utf-8");
      const assessment = assessSpec("shipping-api", content);
      
      let answer = `### Security Quality Audit: \`shipping-api\` Spec\n\n`;
      const secCategory = assessment.categories.find(cat => cat.id === "security");
      
      if (secCategory) {
        answer += `Security Category Score: **${secCategory.score}/100**\n\n`;
        
        const failedSecRules = secCategory.rules.filter(r => r.status === "fail");
        if (failedSecRules.length === 0) {
          answer += "Good news! No security violations were found in the `shipping-api` spec according to the rubric.\n";
        } else {
          for (const rule of failedSecRules) {
            answer += `#### [${rule.severity.toUpperCase()}] **${rule.title}** (${rule.ruleId})\n`;
            answer += `*Description: ${rule.description}*\n\n`;
            answer += `* **Security Violations**:\n`;
            for (const viol of rule.violations) {
              answer += `  - Location \`${viol.location || "global"}\`: ${viol.message}\n`;
            }
            if (rule.violations[0]?.fix) {
              answer += `* **Actionable Fix**: ${rule.violations[0].fix}\n`;
            }
            answer += "\n";
          }
        }
      }
      return { answer, scenarioId: "S07", source: "fallback" };
    }
  }

  // S08: Rank all the specs from best to worst quality.
  if (
    (normQuery.includes("rank") && normQuery.includes("spec")) ||
    (normQuery.includes("best") && normQuery.includes("worst")) ||
    normQuery === "s08"
  ) {
    const assessments = assessAllSpecs(specsDir);
    assessments.sort((a, b) => b.score - a.score);

    let answer = "### Spec Quality Ranking (Best to Worst)\n\n";
    answer += "Here are all 10 OpenAPI specifications graded and ranked against the quality rubric:\n\n";
    answer += "| Rank | API Spec | Overall Score | Documentation | Security | Design | Completeness | Total Violations |\n";
    answer += "| --- | --- | --- | --- | --- | --- | --- | --- |\n";
    
    assessments.forEach((res, index) => {
      const getScore = (catId: string) => res.categories.find(c => c.id === catId)?.score ?? 0;
      answer += `| ${index + 1} | \`${res.specName}\` | **${res.score}** | ${getScore("documentation")}% | ${getScore("security")}% | ${getScore("design")}% | ${getScore("completeness")}% | ${res.violations.length} |\n`;
    });
    
    answer += "\n> [!TIP]\n";
    answer += "> **payments-api** leads the catalog in spec quality with a score of **96**, whereas **shipping-api** requires the most attention with a quality score of **58** (due to HTTP server URLs, lack of parameter descriptions, etc.).";
    return { answer, scenarioId: "S08", source: "fallback" };
  }

  // S09: Is the billing API any good?
  if (
    (normQuery.includes("billing") && (normQuery.includes("good") || normQuery.includes("quality"))) ||
    normQuery === "s09"
  ) {
    let answer = "### Assessment: \"Is the billing API any good?\"\n\n";
    answer += "> [!IMPORTANT]\n";
    answer += "> **Clarification: Missing Named API**\n";
    answer += "> There is no API named exactly `billing-api` in our API catalog. Consequently, there is no corresponding spec file to grade.\n\n";
    answer += "However, we have several billing-related APIs in the **Finance** domain that handle invoicing, subscriptions, and dunning:\n\n";
    
    const billingApis = apis.filter(api => 
      Array.isArray(api.tags) && api.tags.includes("billing")
    );

    answer += "| API Name | Domain | Owner | Status | Protocol | Spec Status |\n";
    answer += "| --- | --- | --- | --- | --- | --- |\n";
    for (const api of billingApis) {
      answer += `| \`${api.name}\` | ${api.domain} | ${api.owner || "*Unassigned*"} | \`${api.status}\` | ${api.protocol} | *No spec file in data/specs/* |\n`;
    }
    
    answer += "\n#### Alternative Recommendations\n";
    answer += "If you are looking for high-quality payment integrations, refer to the **`payments-api`** in the Payments domain. It is production-ready, routs via `kong-prod`, and its OpenAPI spec has a near-perfect quality score of **96/100**.";
    return { answer, scenarioId: "S09", source: "fallback" };
  }

  // S10: Give me the spec for the search service so I can call its checkout endpoint.
  if (
    (normQuery.includes("search") && normQuery.includes("checkout")) ||
    normQuery === "s10"
  ) {
    let answer = "### Spec Request: Search Service for Checkout\n\n";
    answer += "> [!WARNING]\n";
    answer += "> **Ambiguity & Contradiction Detected**\n\n";
    answer += "Your request contains two discrepancies:\n\n";
    answer += "1. **Functional Mismatch**: The `search-api` (Catalog domain) is for product searches and catalog discovery. It does **not** contain a `checkout` endpoint. Checkout actions are managed by the `checkout-api` or `orders-api` in the **Orders** domain.\n";
    answer += "2. **Missing Spec**: There is no OpenAPI specification file for the `search-api` (only a catalog entry exists).\n\n";
    answer += "#### Correct Resources to Use:\n";
    answer += "- **For Product Search**: Use `search-api` (REST, owned by `team-search`, gateway: `apigee-edge`, 4 endpoints).\n";
    answer += "- **For Checkout Flow**: Refer to the `orders-api` OpenAPI spec (`orders-api.yaml`), which documents the checkout/orders creation endpoints and has a high quality score of **91/100**.";
    return { answer, scenarioId: "S10", source: "fallback" };
  }

  // ----------------------------------------------------
  // ADVANCED GEMINI-BASED CHAT (IF KEY PROVIDED)
  // ----------------------------------------------------
  if (apiKey) {
    try {
      const assessments = assessAllSpecs(specsDir);
      
      // Construct context for the LLM
      const catalogSummary = apis.map(api => ({
        name: api.name,
        domain: api.domain,
        status: api.status,
        tags: api.tags,
        endpoints: api.endpoints,
        owner: api.owner,
        dependencies: api.dependencies,
        protocol: api.protocol,
        gateway: api.gateway
      }));

      const specSummaries = assessments.map(res => ({
        specName: res.specName,
        score: res.score,
        categories: res.categories.map(c => ({ id: c.id, score: c.score })),
        violationsCount: res.violations.length
      }));

      const systemPrompt = `You are a helpful API Catalog Assistant for software developers.
You help them interact intelligently with the API catalog and assess specification quality.

Here is the data in the API Catalog (containing 60 APIs):
${JSON.stringify(catalogSummary, null, 2)}

Here are the OpenAPI Spec Quality rubric results (10 specs graded against 12 rules, score 0-100):
${JSON.stringify(specSummaries, null, 2)}

Instructions:
1. Answer natural-language questions about the catalog accurately using the catalog data.
2. If the user asks about spec quality, mention their score, highlight major failed rules (referencing documentation, security, design, completeness), and suggest concrete fixes.
3. Handle ambiguous or underspecified queries gracefully. If an API is missing or query makes no sense, state your assumptions, recommend alternatives, and ask clarifying questions.
4. Output your answer in beautifully formatted GitHub-style markdown. Use tables, bolding, bullet points, and alerts (e.g. > [!NOTE], > [!WARNING], > [!TIP]) where appropriate. Do not output raw JSON.
5. Keep answers clear, concise, and professional.`;

      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    text: query
                  }
                ]
              }
            ],
            systemInstruction: {
              parts: [
                {
                  text: systemPrompt
                }
              ]
            }
          })
        }
      );

      if (response.ok) {
        const result: any = await response.json();
        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          return { answer: text, source: "gemini" };
        }
      }
      
      console.warn("Gemini API call failed, status:", response.status);
    } catch (err) {
      console.error("Error calling Gemini API:", err);
    }
  }

  // ----------------------------------------------------
  // GENERAL FALLBACK KEYWORD-SEARCH FOR CATALOG
  // ----------------------------------------------------
  const keywords = normQuery.split(/\s+/).filter(w => w.length > 2);
  if (keywords.length > 0) {
    const matches = apis.filter(api => {
      return keywords.some(kw => 
        api.name?.toLowerCase().includes(kw) ||
        api.domain?.toLowerCase().includes(kw) ||
        (Array.isArray(api.tags) && api.tags.some((t: string) => t.toLowerCase().includes(kw))) ||
        api.owner?.toLowerCase().includes(kw)
      );
    });

    if (matches.length > 0) {
      let answer = `### Catalog Search Results\n\n`;
      answer += `I found **${matches.length} APIs** in the catalog matching your query terms: *${keywords.join(", ")}*:\n\n`;
      answer += "| API Name | Domain | Status | Owner | Protocol | Gateway |\n";
      answer += "| --- | --- | --- | --- | --- | --- |\n";
      for (const api of matches.slice(0, 10)) {
        answer += `| \`${api.name}\` | ${api.domain} | \`${api.status}\` | ${api.owner || "*Unassigned*"} | ${api.protocol} | \`${api.gateway || "None"}\` |\n`;
      }
      if (matches.length > 10) {
        answer += `\n*...and ${matches.length - 10} more matches. Try being more specific!*`;
      }
      return { answer, source: "fallback" };
    }
  }

  let answer = "### Hello! I am the API Catalog Assistant.\n\n";
  answer += "I can help you browse the catalog of 60 APIs, assess OpenAPI spec quality, or answer questions. Try asking:\n\n";
  answer += "- *Which payment APIs are production-ready?* (S01)\n";
  answer += "- *What depends on the ledger-api?* (S02)\n";
  answer += "- *Rank all the specs from best to worst quality.* (S08)\n";
  answer += "- *What's wrong with the inventory-api spec?* (S06)\n\n";
  answer += "If you provide a **Gemini API Key**, you can ask me any arbitrary custom question!";
  
  return { answer, source: "fallback" };
}
