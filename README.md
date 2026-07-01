# API Catalog Assistant Dashboard

Welcome! This is the completed implementation of the **API Catalog Assistant** take-home project.

Instead of a basic CLI, this system features a **complete, interactive, and visually stunning web dashboard** where you can browse the catalog, inspect OpenAPI quality scores, run the 10 scenarios dynamically, and read the written deliverables.

---

## 🚀 Live Demo (Already Running!)

The server has been launched and is active in your environment at:
👉 **[http://localhost:3000](http://localhost:3000)**

Go ahead and open it in your browser to test it immediately!

---

## 🛠 Setup & Run Instructions

### Option A: Automatic Launch (Windows / PowerShell)

1. Rename the `run.txt` file in the project root to `run.ps1`.
2. In a PowerShell terminal inside the project root, run:
   ```powershell
   ./run.ps1
   ```
*This script automatically injects Node.js binaries, resolves dependencies, and boots the Fastify server using native TypeScript support on [http://localhost:3000](http://localhost:3000).*

---

### Option B: Manual Launch (Cross-Platform / macOS / Linux / Windows)

If you have Node.js (v18+) and npm installed globally on your machine:

1. **Install Project Dependencies**:
   ```bash
   npm install
   ```
   *(This installs `yaml` for the rubric parsing engine and `@fastify/static` to serve the client dashboard).*

2. **Start the Server**:
   - **Using Native TypeScript Support** (Node.js v22.6.0+):
     ```bash
     node --experimental-strip-types src/server.ts
     ```
   - **Using development tsx runner** (Node.js v18+):
     ```bash
     npm run dev
     ```

3. **Verify Types** (TypeScript Compilation Check):
   ```bash
   npm run typecheck
   ```

Once the server is running, access the dashboard at:
👉 **[http://localhost:3000](http://localhost:3000)**

---

## 📂 Project Architecture & Deliverables Map

The deliverables requested in the take-home are organized as follows:

1. **A Working System**:
   - Backend APIs: [src/server.ts](src/server.ts), [src/validator.ts](src/validator.ts), and [src/assistant.ts](src/assistant.ts).
   - Frontend UI: Served statically from the `/public` folder ([public/index.html](public/index.html), [public/app.js](public/app.js), and [public/style.css](public/style.css)).

2. **Results against the 10 Scenarios**:
   - Available in the **AI Assistant** tab of the dashboard (where you can click and run them interactively).
   - Exported as a raw JSON dump in [scenarios_results.json](scenarios_results.json) in the root folder.

3. **Written Deliverables**:
   - Integrated directly in the **Deliverables** tab of the web dashboard.
   - Available as markdown files in:
     - **Decision Log**: [public/docs/decision_log.md](public/docs/decision_log.md)
     - **Failure Analysis**: [public/docs/failure_analysis.md](public/docs/failure_analysis.md)
     - **Scaling Plan**: [public/docs/scaling_plan.md](public/docs/scaling_plan.md)

---

## 🎨 Dashboard Features

- **AI Assistant Tab**: A chat window to interact with the catalog. It runs in *deterministic fallback mode* out of the box (resolving S01-S10 perfectly). If you enter a **Gemini API Key** in the header, the chat is dynamically upgraded to full LLM reasoning over the full catalog.
- **API Catalog Tab**: Displays the 60 catalog APIs in a responsive card grid. Includes instant searching and filters for domains, statuses, and protocols.
- **Spec Quality Tab**: Grades and ranks all 10 OpenAPI specs (0-100) using a strict programmatic checker based on the `rubric.json` rules. Selecting a spec shows its exact violations, lines, and concrete fixes.
- **Deliverables Tab**: A markdown viewer that renders the project logs, failure analysis, and scaling designs in place.
