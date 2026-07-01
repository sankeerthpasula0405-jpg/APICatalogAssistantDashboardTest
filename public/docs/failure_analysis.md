# Failure Analysis

This document identifies the limitations of the current implementation, explains under what circumstances the system might break or fail, and outlines how these issues would be mitigated in a production-grade system.

---

## 1. Rubric Validator Limitations

### A. Local Reference Resolution Only
- **Issue**: The validator does not resolve external `$ref` pointers (e.g. `$ref: 'https://specs.example.com/common.yaml#/schemas/Error'`). It only traverses references defined locally within the same YAML file.
- **Impact**: External references will bypass description and property casing checks (DOC-02, DES-02) and might cause false positives for CMP-02 (claiming a response lacks a structured schema).
- **Mitigation**: Integrate a resolver library (such as `@apidevtools/json-schema-ref-parser`) to dereference all external schemas before running the rubric checks.

### B. Rigid Casing Rules (DES-02)
- **Issue**: Rule DES-02 hardcodes a check for `camelCase`. While `camelCase` is the industry standard, some spec authors use `snake_case` consistently.
- **Impact**: A well-structured spec written entirely in consistent `snake_case` would receive a failing grade for DES-02.
- **Mitigation**: Adjust the check to dynamically detect the dominant casing convention used in the spec and verify consistency against *that* convention, rather than enforcing camelCase globally.

### C. Simple Noun/Verb Heuristics (DES-01)
- **Issue**: The REST naming check uses simple list matching to check for singular nouns and verbs.
- **Impact**: It might miss uncommon verbs or flag segments that coincidentally contain sub-strings of common verbs (e.g., flagging `/advertisements` because it contains `add`).
- **Mitigation**: Use a proper English pluralization library (e.g. `pluralize`) and a Part-of-Speech tagger (NLP) to parse route paths semantically.

---

## 2. Assistant Chat Limitations

### A. Fallback Mode Scope
- **Issue**: In the absence of a `GEMINI_API_KEY`, the assistant relies on scenario matching and keyword indexing.
- **Impact**: If a user asks a complex natural language query that isn't one of the 10 scenarios, the fallback answer will be limited to showing a list of matching APIs.
- **Mitigation**: Prompt the user to enter their API key, which immediately resolves this by upgrading the system to full LLM capability.

### B. LLM Context Window & Hallucinations
- **Issue**: When using the Gemini API, we include the catalog summary and spec scores in the prompt context. If the user asks a deep question about the internal operations of a spec, the LLM might hallucinate answers because the full spec content is not in its prompt.
- **Impact**: The LLM might state an endpoint has a parameter it doesn't actually have, or misread schema structures.
- **Mitigation**: Implement a RAG (Retrieval-Augmented Generation) workflow. When a user asks about a specific API, dynamically read its yaml file and inject it into the prompt context for the LLM to analyze.
