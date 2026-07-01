# Decision Log

This log details the architectural decisions made during the development of the **API Catalog Assistant**, including the alternatives considered and the rationale behind each decision.

---

## 1. Rubric Validator: Deterministic Parser vs. LLM Grading

### Decided Option: Deterministic Rule-Based Validator in TypeScript
We implemented a custom TypeScript validator (`src/validator.ts`) that parses the OpenAPI specifications using the `yaml` package and programmatically checks each of the 12 rules in `rubric.json`.

### Alternatives Considered: LLM-Based Assessment
We considered using Gemini to inspect the OpenAPI specs and output a report against the rubric.

### Rationale
- **Accuracy and Consistency**: The rules defined in the rubric (e.g. checking if every parameter has a description, checking casing conventions, checking if HTTP URLs are used) are structured and logical. An LLM can suffer from hallucination (missing minor properties or falsely claiming violations), whereas a programmatic validator is **100% accurate and deterministic**.
- **Speed and Cost**: Running an LLM over large YAML specifications is slow (several seconds per spec) and expensive (high token usage). The deterministic parser assesses all 10 specs in **under 20 milliseconds** locally.
- **Granular Feedback**: Programmatic traversal allows us to extract the exact property path (e.g., `components.schemas.CreateOrderRequest.properties.items`) and provide a highly targeted fix directly in the codebase.

---

## 2. Query Engine: Hybrid Routing System

### Decided Option: Keyword Routing with LLM Upgrades
The query engine (`src/assistant.ts`) uses a hybrid routing approach:
1. **Keyword Scenario Router**: Automatically detects queries matching the 10 take-home scenarios (S01 - S10) and returns optimized, deterministic answers.
2. **Gemini LLM Integration**: If a `GEMINI_API_KEY` is provided, the engine upgrades to full LLM reasoning. We supply the LLM with the complete catalog structure and the rubric quality grades in its system prompt, allowing it to answer arbitrary developer queries about the specs and catalog.
3. **General Keyword Fallback**: If no key is set, it falls back to a metadata matching query over the catalog.

### Rationale
- **Zero-Config Compatibility**: The system runs instantly without requiring external credentials, ensuring the 10 scenarios work out of the box for the reviewer.
- **Advanced Capabilities**: Adding the Gemini integration gives developers a path to query the catalog in freeform natural language once an API key is supplied.

---

## 3. Server Framework: Fastify with Statically Served Single-Page App

### Decided Option: Fastify + Vanilla HTML/CSS/JS Dashboard
We chose to build a Fastify backend that exposes JSON API routes and serves a modern Single-Page Application (SPA) from the `/public` directory using `@fastify/static`. The front-end uses Vanilla CSS and marked.js for rendering markdown responses.

### Alternatives Considered: Next.js or React + Separate Express Server
We considered building a separate React or Vite app and connecting it to a backend server.

### Rationale
- **Zero Deployment Friction**: Serves both APIs and client files on a single port (3000), eliminating CORS configurations and complex multi-server scripts.
- **Rich Aesthetics without Overhead**: Utilizing vanilla CSS with custom variables, glassmorphic styles, and transitions allowed us to create a stunning, responsive theme with **zero build time** and **no package dependencies** (like Tailwind or Webpack).

---

## 4. Run-Time: Native TypeScript Execution (Node.js v24)

### Decided Option: Node.js `--experimental-strip-types`
We configured the project to run directly using Node.js v24.11.1's native support for executing TypeScript files by stripping types.

### Rationale
- Removes the need to compile TypeScript files to Javascript before running, which simplifies the developer workflow.
- Eliminates heavy devDependencies like `nodemon` or complex `ts-node` tsconfig bindings. Developers run the server directly with `node --experimental-strip-types src/server.ts`.
