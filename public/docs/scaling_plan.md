# Scaling Plan

This plan details how the **API Catalog Assistant** would be scaled to support **10,000+ APIs** and **hundreds of OpenAPI specs** while maintaining high performance, reliability, and security.

---

## 1. Database & Search Infrastructure

### A. Database Migration
- **Current**: Direct file reads from `catalog.json`.
- **Target**: Migrate the catalog data to a scalable database like **PostgreSQL** (relational) or **MongoDB** (document). Use a cache layer like **Redis** to store frequently read catalog entries.

### B. Search Engine Integration
- **Current**: Local JS keyword filters.
- **Target**: Deploy **Elasticsearch** or **OpenSearch** to index the catalog. This allows:
  - Full-text search with fuzzy matching, spelling correction, and relevance ranking.
  - Faceted filtering across domains, protocols, and owners at sub-millisecond speeds.

### C. Vector Search (Semantic NLP)
- **Target**: Implement a Vector database (e.g. **pgvector** or **Pinecone**).
  - Generate embeddings for API metadata (name, description, tags, domain).
  - Use vector similarity search to map vague natural language queries (e.g. *"Which service handles credit card payouts?"*) to the exact API matching the user's intent.

---

## 2. Spec Grading & Linting at Scale

### A. CI/CD Linting (Shift-Left Quality)
- **Target**: Move grading checks to developer pull requests.
  - Create a CLI runner of our validator: `node src/validator-cli.ts --file ./specs/orders-api.yaml`.
  - Add a GitHub Actions check that runs this validator on every PR modifying a spec.
  - **Enforcement**: Fail the PR build if a spec's quality score falls below **80**, or if any **high-severity** rule (like SEC-01 or SEC-02) fails.

### B. Spec Grade Caching
- **Current**: Re-grades all specs on every request to `/api/specs`.
- **Target**: Persist quality scores and violations in the database. Only trigger re-grading when:
  - A new spec is onboarded.
  - An existing spec file is modified (detected via a webhook from GitHub/GitLab).
  - This reduces CPU overhead on the API server to zero for read operations.

---

## 3. RAG Pipeline for Intelligent LLM Answers

With thousands of specs, we cannot fit all catalog entries and spec schemas in a single LLM prompt due to context window limits and cost.

- **Target**: Implement a **Retrieval-Augmented Generation (RAG)** pipeline:
  1. User asks: *"How do I authenticate against the shipping service?"*
  2. The assistant queries the vector database / Elasticsearch to locate the most relevant API (`shipping-api`).
  3. The system reads the `shipping-api.yaml` spec file and extracts its `securitySchemes` and `servers` blocks.
  4. Inject **only** the relevant `shipping-api` segments and the user's query into the prompt to Gemini.
  5. The LLM generates a highly accurate, context-specific response, keeping token costs minimal and response times fast.
