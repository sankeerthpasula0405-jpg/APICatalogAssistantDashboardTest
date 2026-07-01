import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import * as path from "path";
import * as fs from "fs";
import { assessAllSpecs, assessSpec } from "./validator.ts";
import { askAssistant } from "./assistant.ts";

const app = Fastify({ logger: true });

// Resolve paths
const publicPath = path.resolve("public");
const catalogPath = path.resolve("data/catalog.json");
const specsDir = path.resolve("data/specs");
const scenariosPath = path.resolve("data/scenarios.json");

// Register static plugin
app.register(fastifyStatic, {
  root: publicPath,
  prefix: "/",
});

app.get("/health", async () => ({ status: "ok" }));

// 1. GET /api/catalog - Get full catalog
app.get("/api/catalog", async (request, reply) => {
  try {
    if (!fs.existsSync(catalogPath)) {
      return reply.status(404).send({ error: "Catalog not found" });
    }
    const content = fs.readFileSync(catalogPath, "utf-8");
    return JSON.parse(content);
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// 2. GET /api/specs - Get all spec assessments ranked
app.get("/api/specs", async (request, reply) => {
  try {
    const results = assessAllSpecs(specsDir);
    // Sort by score descending
    results.sort((a, b) => b.score - a.score);
    return results;
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// 3. GET /api/specs/:name - Get individual spec assessment
app.get("/api/specs/:name", async (request, reply) => {
  try {
    const { name } = request.params as { name: string };
    const filePath = path.join(specsDir, `${name}.yaml`);
    if (!fs.existsSync(filePath)) {
      return reply.status(404).send({ error: `Spec file for ${name} not found.` });
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const result = assessSpec(name, content);
    return result;
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// 4. POST /api/chat - Query the catalog assistant
app.post("/api/chat", async (request, reply) => {
  try {
    const { query, apiKey } = request.body as { query: string; apiKey?: string };
    if (!query) {
      return reply.status(400).send({ error: "Query is required" });
    }
    const finalApiKey = apiKey || process.env.GEMINI_API_KEY;
    const response = await askAssistant(query, finalApiKey);
    return response;
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

// 5. GET /api/scenarios - List the 10 scenarios and run them
app.get("/api/scenarios", async (request, reply) => {
  try {
    if (!fs.existsSync(scenariosPath)) {
      return reply.status(404).send({ error: "Scenarios list not found." });
    }
    const content = fs.readFileSync(scenariosPath, "utf-8");
    const scenariosObj = JSON.parse(content);
    
    // Auto-run each scenario to attach the result
    const runScenarios = [];
    for (const sc of scenariosObj.scenarios || []) {
      const res = await askAssistant(sc.prompt, process.env.GEMINI_API_KEY);
      runScenarios.push({
        ...sc,
        answer: res.answer,
        source: res.source,
      });
    }

    return {
      ...scenariosObj,
      scenarios: runScenarios,
    };
  } catch (err: any) {
    return reply.status(500).send({ error: err.message });
  }
});

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
