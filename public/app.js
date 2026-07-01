// App State
const state = {
  activeTab: "assistant",
  apiKey: localStorage.getItem("gemini_api_key") || "",
  catalog: [],
  specs: [],
  selectedSpec: null,
  scenarios: [],
  deliverablesSubTab: "decision",
  deliverablesCache: {
    decision: "",
    failure: "",
    scaling: "",
  },
};

// DOM Elements
const el = {
  navTabs: document.querySelectorAll(".nav-tab"),
  tabPanels: document.querySelectorAll(".tab-panel"),
  apiKeyInput: document.getElementById("apiKeyInput"),
  saveKeyBtn: document.getElementById("saveKeyBtn"),
  
  // Chat elements
  chatMessages: document.getElementById("chatMessages"),
  chatInput: document.getElementById("chatInput"),
  sendBtn: document.getElementById("sendBtn"),
  scenarioList: document.getElementById("scenarioList"),
  
  // Catalog elements
  catalogGrid: document.getElementById("catalogGrid"),
  catalogSearch: document.getElementById("catalogSearch"),
  domainFilter: document.getElementById("domainFilter"),
  statusFilter: document.getElementById("statusFilter"),
  protocolFilter: document.getElementById("protocolFilter"),
  catalogCount: document.getElementById("catalogCount"),
  
  // Quality elements
  specRankList: document.getElementById("specRankList"),
  qualityDetails: document.getElementById("qualityDetails"),
  
  // Deliverables elements
  subTabs: document.querySelectorAll(".sub-tab"),
  deliverablesContent: document.getElementById("deliverablesContent"),
};

// Initialize App
document.addEventListener("DOMContentLoaded", () => {
  // Restore API key input value
  if (state.apiKey) {
    el.apiKeyInput.value = state.apiKey;
  }

  // Setup Event Listeners
  setupNavigation();
  setupApiKey();
  setupChat();
  setupCatalogFilters();
  setupDeliverablesNav();

  // Load initial data
  loadCatalogData();
  loadSpecData();
  loadScenarios();
  loadDeliverable("decision");
});

// ----------------------------------------------------
// NAVIGATION SYSTEM
// ----------------------------------------------------
function setupNavigation() {
  el.navTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const targetTab = tab.getAttribute("data-tab");
      state.activeTab = targetTab;
      
      // Update Tab Buttons
      el.navTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      
      // Update Panels
      el.tabPanels.forEach((panel) => {
        panel.classList.remove("active");
        if (panel.id === `panel-${targetTab}`) {
          panel.classList.add("active");
        }
      });
      
      // Auto-trigger loads if needed
      if (targetTab === "catalog" && state.catalog.length === 0) {
        loadCatalogData();
      } else if (targetTab === "quality" && state.specs.length === 0) {
        loadSpecData();
      }
    });
  });
}

// ----------------------------------------------------
// API KEY MANAGER
// ----------------------------------------------------
function setupApiKey() {
  el.saveKeyBtn.addEventListener("click", () => {
    const value = el.apiKeyInput.value.trim();
    state.apiKey = value;
    localStorage.setItem("gemini_api_key", value);
    
    // Feedback animation
    const originalText = el.saveKeyBtn.textContent;
    el.saveKeyBtn.textContent = "Saved!";
    el.saveKeyBtn.style.borderColor = "var(--status-prod)";
    el.saveKeyBtn.style.color = "var(--status-prod)";
    setTimeout(() => {
      el.saveKeyBtn.textContent = originalText;
      el.saveKeyBtn.style.borderColor = "";
      el.saveKeyBtn.style.color = "";
    }, 1500);
  });
}

// ----------------------------------------------------
// CHAT & SCENARIO RUNNER
// ----------------------------------------------------
function setupChat() {
  const sendMessage = async () => {
    const text = el.chatInput.value.trim();
    if (!text) return;
    
    // Clear Input
    el.chatInput.value = "";
    
    // Add User Message
    appendMessage("user", text);
    
    // Add Loading Indicator
    const loadingId = appendLoadingMessage();
    
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, apiKey: state.apiKey }),
      });
      
      removeLoadingMessage(loadingId);
      
      if (response.ok) {
        const data = await response.json();
        appendMessage("assistant", data.answer, data.source);
      } else {
        const err = await response.json();
        appendMessage("assistant", `Error: ${err.error || "Failed to query server."}`);
      }
    } catch (err) {
      removeLoadingMessage(loadingId);
      appendMessage("assistant", `Connection error: ${err.message}`);
    }
  };

  el.sendBtn.addEventListener("click", sendMessage);
  el.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendMessage();
  });
}

function appendMessage(sender, text, source) {
  const msgEl = document.createElement("div");
  msgEl.classList.add("message", sender);
  
  const senderLabel = sender === "user" ? "You" : (source === "gemini" ? "AI Assistant (Gemini)" : "Catalog Assistant");
  
  let sourceBadge = "";
  if (sender === "assistant" && source) {
    sourceBadge = ` <span class="scenario-badge" style="font-size:0.6rem; vertical-align:middle; background:rgba(255,255,255,0.06); border-color:var(--border-glass)">${source}</span>`;
  }

  // Parse markdown for assistant messages
  const htmlContent = sender === "assistant" ? marked.parse(text) : `<p>${escapeHTML(text)}</p>`;

  msgEl.innerHTML = `
    <div class="message-sender">${senderLabel}${sourceBadge}</div>
    <div class="message-text">${htmlContent}</div>
  `;
  
  el.chatMessages.appendChild(msgEl);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
}

function appendLoadingMessage() {
  const id = "loading-" + Date.now();
  const msgEl = document.createElement("div");
  msgEl.classList.add("message", "assistant", "loading-msg");
  msgEl.id = id;
  msgEl.innerHTML = `
    <div class="message-sender">Assistant</div>
    <div class="message-text">
      <div class="loading-spinner" style="padding:10px 0; justify-content:flex-start">Thinking...</div>
    </div>
  `;
  el.chatMessages.appendChild(msgEl);
  el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  return id;
}

function removeLoadingMessage(id) {
  const msgEl = document.getElementById(id);
  if (msgEl) msgEl.remove();
}

function escapeHTML(str) {
  return str.replace(/[&<>'"]/g, 
    tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
  );
}

async function loadScenarios() {
  try {
    const response = await fetch("/api/scenarios");
    if (response.ok) {
      const data = await response.json();
      state.scenarios = data.scenarios || [];
      renderScenarios();
    } else {
      el.scenarioList.innerHTML = `<div class="error-msg">Failed to load scenarios.</div>`;
    }
  } catch (err) {
    el.scenarioList.innerHTML = `<div class="error-msg">Connection error.</div>`;
  }
}

function renderScenarios() {
  el.scenarioList.innerHTML = "";
  state.scenarios.forEach((sc) => {
    const item = document.createElement("div");
    item.classList.add("scenario-item", sc.type);
    item.setAttribute("data-id", sc.id);
    
    item.innerHTML = `
      <div class="scenario-badge">${sc.id} &bull; ${sc.type}</div>
      <div class="scenario-prompt">${escapeHTML(sc.prompt)}</div>
    `;
    
    item.addEventListener("click", () => {
      // Switch to assistant tab if not active
      if (state.activeTab !== "assistant") {
        document.querySelector("[data-tab='assistant']").click();
      }
      // Populate chat input and submit
      el.chatInput.value = sc.prompt;
      el.sendBtn.click();
    });
    
    el.scenarioList.appendChild(item);
  });
}

// ----------------------------------------------------
// CATALOG BROWSER
// ----------------------------------------------------
async function loadCatalogData() {
  try {
    const response = await fetch("/api/catalog");
    if (response.ok) {
      const data = await response.json();
      state.catalog = data.apis || [];
      
      // Populate unique domains filter
      const domains = [...new Set(state.catalog.map(api => api.domain))].filter(Boolean);
      domains.sort();
      
      el.domainFilter.innerHTML = `<option value="">All Domains</option>`;
      domains.forEach(dom => {
        el.domainFilter.innerHTML += `<option value="${dom}">${dom}</option>`;
      });
      
      renderCatalogGrid();
    } else {
      el.catalogGrid.innerHTML = `<div class="error-msg">Failed to load catalog.</div>`;
    }
  } catch (err) {
    el.catalogGrid.innerHTML = `<div class="error-msg">Connection error.</div>`;
  }
}

function setupCatalogFilters() {
  const handler = () => renderCatalogGrid();
  el.catalogSearch.addEventListener("input", handler);
  el.domainFilter.addEventListener("change", handler);
  el.statusFilter.addEventListener("change", handler);
  el.protocolFilter.addEventListener("change", handler);
}

function renderCatalogGrid() {
  const searchVal = el.catalogSearch.value.toLowerCase().trim();
  const domainVal = el.domainFilter.value;
  const statusVal = el.statusFilter.value;
  const protocolVal = el.protocolFilter.value;
  
  const filtered = state.catalog.filter(api => {
    // Search matching
    const matchesSearch = !searchVal || 
      api.name?.toLowerCase().includes(searchVal) ||
      api.owner?.toLowerCase().includes(searchVal) ||
      (Array.isArray(api.tags) && api.tags.some(t => t.toLowerCase().includes(searchVal)));
      
    // Dropdown filters matching
    const matchesDomain = !domainVal || api.domain === domainVal;
    const matchesStatus = !statusVal || api.status?.toLowerCase() === statusVal.toLowerCase();
    const matchesProtocol = !protocolVal || api.protocol?.toLowerCase() === protocolVal.toLowerCase();
    
    return matchesSearch && matchesDomain && matchesStatus && matchesProtocol;
  });
  
  el.catalogCount.textContent = filtered.length;
  
  if (filtered.length === 0) {
    el.catalogGrid.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1">
        <p>No APIs match the search filters.</p>
      </div>
    `;
    return;
  }
  
  el.catalogGrid.innerHTML = "";
  filtered.forEach(api => {
    const card = document.createElement("div");
    card.classList.add("catalog-card");
    
    const tagsHtml = Array.isArray(api.tags) 
      ? api.tags.map(t => `<span class="tag-badge ${t === 'core' || t === 'external' ? t : ''}">${t}</span>`).join("")
      : "";
      
    const gatewayLabel = api.gateway ? api.gateway : "None";

    card.innerHTML = `
      <div class="card-top">
        <div class="card-title-row">
          <div class="card-name">${escapeHTML(api.name)}</div>
          <span class="card-status-badge ${api.status?.toLowerCase()}">${api.status}</span>
        </div>
        <div class="card-domain">${api.domain}</div>
      </div>
      <div class="card-meta-row">
        <div>
          <div class="meta-item-label">Owner</div>
          <div class="meta-item-val" title="${api.owner}">${api.owner || "Unassigned"}</div>
        </div>
        <div>
          <div class="meta-item-label">Protocol</div>
          <div class="meta-item-val">${api.protocol}</div>
        </div>
        <div style="margin-top:6px">
          <div class="meta-item-label">Endpoints</div>
          <div class="meta-item-val">${api.endpoints}</div>
        </div>
        <div style="margin-top:6px">
          <div class="meta-item-label">Gateway</div>
          <div class="meta-item-val" title="${gatewayLabel}">${gatewayLabel}</div>
        </div>
      </div>
      <div class="card-tags">
        ${tagsHtml}
      </div>
    `;
    
    // Quick action: if it has spec, double click or button goes to spec grading
    card.addEventListener("click", () => {
      // Check if this API has a spec file by looking at state.specs
      const hasSpec = state.specs.some(s => s.specName === api.name);
      if (hasSpec) {
        document.querySelector("[data-tab='quality']").click();
        const rankItem = document.querySelector(`.rank-item[data-spec="${api.name}"]`);
        if (rankItem) rankItem.click();
      }
    });
    
    el.catalogGrid.appendChild(card);
  });
}

// ----------------------------------------------------
// SPEC QUALITY DASHBOARD
// ----------------------------------------------------
async function loadSpecData() {
  try {
    const response = await fetch("/api/specs");
    if (response.ok) {
      state.specs = await response.json();
      renderSpecRankings();
      if (state.specs.length > 0 && !state.selectedSpec) {
        // Auto select first spec
        selectSpec(state.specs[0].specName);
      }
    } else {
      el.specRankList.innerHTML = `<div class="error-msg">Failed to load grading.</div>`;
    }
  } catch (err) {
    el.specRankList.innerHTML = `<div class="error-msg">Connection error.</div>`;
  }
}

function renderSpecRankings() {
  el.specRankList.innerHTML = "";
  state.specs.forEach((spec) => {
    const item = document.createElement("div");
    item.classList.add("rank-item");
    item.setAttribute("data-spec", spec.specName);
    if (state.selectedSpec === spec.specName) {
      item.classList.add("active");
    }
    
    const gradeClass = getGradeClass(spec.score);
    
    item.innerHTML = `
      <div class="rank-title-row">
        <div class="rank-name">${spec.specName}</div>
        <div class="rank-score ${gradeClass}">${spec.score}</div>
      </div>
      <div class="rank-progress-bar">
        <div class="rank-progress-fill ${gradeClass}" style="width: ${spec.score}%"></div>
      </div>
    `;
    
    item.addEventListener("click", () => {
      selectSpec(spec.specName);
    });
    
    el.specRankList.appendChild(item);
  });
}

function getGradeClass(score) {
  if (score >= 90) return "high-grade";
  if (score >= 70) return "medium-grade";
  return "low-grade";
}

function getSeverityClass(sev) {
  if (sev === "high") return "high-sev";
  if (sev === "medium") return "medium-sev";
  return "low-sev";
}

function selectSpec(specName) {
  state.selectedSpec = specName;
  // Update rankings active item class
  const items = el.specRankList.querySelectorAll(".rank-item");
  items.forEach(it => {
    it.classList.remove("active");
    if (it.getAttribute("data-spec") === specName) {
      it.classList.add("active");
    }
  });

  const specData = state.specs.find(s => s.specName === specName);
  if (specData) {
    renderSpecDetail(specData);
  }
}

function renderSpecDetail(data) {
  const gradeClass = getGradeClass(data.score);
  
  let catsHtml = "";
  data.categories.forEach(cat => {
    const catGradeClass = getGradeClass(cat.score);
    catsHtml += `
      <div class="cat-score-card">
        <div class="cat-score-name">${cat.name}</div>
        <div class="cat-score-val ${catGradeClass}">${cat.score}%</div>
      </div>
    `;
  });

  let violsHtml = "";
  if (data.violations.length === 0) {
    violsHtml = `
      <div class="empty-state" style="padding: 20px 0; justify-content: flex-start">
        <p style="color: var(--status-prod)">🎉 Spec is 100% compliant with the quality rubric! No violations found.</p>
      </div>
    `;
  } else {
    // Sort violations by severity weight descending: high, medium, low
    const sortedViols = [...data.violations];
    const sevOrder = { high: 3, medium: 2, low: 1 };
    
    // Grab rules configuration to lookup severity
    sortedViols.sort((a, b) => {
      const ruleA = lookupRule(a.ruleId);
      const ruleB = lookupRule(b.ruleId);
      const sevA = ruleA ? sevOrder[ruleA.severity] : 0;
      const sevB = ruleB ? sevOrder[ruleB.severity] : 0;
      return sevB - sevA;
    });

    sortedViols.forEach(viol => {
      const rule = lookupRule(viol.ruleId);
      const sev = rule ? rule.severity : "low";
      const ruleTitle = rule ? rule.title : "Unknown Rule";
      const sevClass = getSeverityClass(sev);

      violsHtml += `
        <div class="violation-card ${sevClass}">
          <div class="violation-meta">
            <div class="violation-loc">Location: <span>${escapeHTML(viol.location || "global")}</span></div>
            <div class="violation-sev-badge">${sev} severity &bull; ${viol.ruleId}</div>
          </div>
          <div class="violation-msg">
            <strong>${ruleTitle}</strong>: ${escapeHTML(viol.message)}
          </div>
          ${viol.fix ? `<div class="violation-fix"><strong>Concrete Fix:</strong> ${escapeHTML(viol.fix)}</div>` : ""}
        </div>
      `;
    });
  }

  el.qualityDetails.innerHTML = `
    <div class="report-header">
      <div class="report-title-area">
        <h2>${data.specName}</h2>
        <div class="card-domain" style="font-size:0.9rem">OpenAPI Specification Quality Audit</div>
      </div>
      <div class="report-score-block">
        <div class="circular-score ${gradeClass}">${data.score}</div>
      </div>
    </div>

    <div class="report-categories-summary">
      ${catsHtml}
    </div>

    <div class="violations-header">Rubric Violations (${data.violations.length})</div>
    <div class="violations-list">
      ${violsHtml}
    </div>
  `;
}

// Helpers to lookup rule details
const rubricRulesCache = [
  { id: "DOC-01", severity: "medium", title: "Operations are documented" },
  { id: "DOC-02", severity: "low", title: "Parameters and schema properties are described" },
  { id: "DOC-03", severity: "low", title: "Request and response bodies provide examples" },
  { id: "SEC-01", severity: "high", title: "Security schemes are defined" },
  { id: "SEC-02", severity: "high", title: "Operations require authentication" },
  { id: "SEC-03", severity: "medium", title: "Transport and examples are safe" },
  { id: "DES-01", severity: "medium", title: "Consistent path naming" },
  { id: "DES-02", severity: "low", title: "Consistent property casing" },
  { id: "DES-03", severity: "medium", title: "Operations have unique operationIds" },
  { id: "CMP-01", severity: "medium", title: "Error responses are declared" },
  { id: "CMP-02", severity: "high", title: "Responses reference a schema" },
  { id: "CMP-03", severity: "low", title: "Spec metadata is complete" },
];

function lookupRule(ruleId) {
  return rubricRulesCache.find(r => r.id === ruleId);
}

// ----------------------------------------------------
// WRITTEN DELIVERABLES
// ----------------------------------------------------
function setupDeliverablesNav() {
  el.subTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const subtab = tab.getAttribute("data-subtab");
      state.deliverablesSubTab = subtab;
      
      el.subTabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      
      loadDeliverable(subtab);
    });
  });
}

async function loadDeliverable(subtab) {
  // Check Cache first
  if (state.deliverablesCache[subtab]) {
    renderDeliverable(state.deliverablesCache[subtab]);
    return;
  }
  
  el.deliverablesContent.innerHTML = `<div class="loading-spinner">Loading documentation...</div>`;
  
  try {
    const response = await fetch(`/docs/${subtab}_log.md`); // We can fetch directly from static /docs/
    if (response.ok) {
      const text = await response.text();
      state.deliverablesCache[subtab] = text;
      renderDeliverable(text);
    } else {
      // Fallback: try mapping subtab ID to file
      const filenameMap = {
        decision: "/docs/decision_log.md",
        failure: "/docs/failure_analysis.md",
        scaling: "/docs/scaling_plan.md"
      };
      const res = await fetch(filenameMap[subtab]);
      if (res.ok) {
        const text = await res.text();
        state.deliverablesCache[subtab] = text;
        renderDeliverable(text);
      } else {
        el.deliverablesContent.innerHTML = `<div class="error-msg">Failed to load file. Verify file exists at ${filenameMap[subtab]}.</div>`;
      }
    }
  } catch (err) {
    el.deliverablesContent.innerHTML = `<div class="error-msg">Connection error: ${err.message}</div>`;
  }
}

function renderDeliverable(markdownText) {
  el.deliverablesContent.innerHTML = marked.parse(markdownText);
}
