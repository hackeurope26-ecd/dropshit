# DropShit - Chrome Extension

Detects dropshipped products and finds original wholesale sources. Shows users markup percentages and cheaper alternatives.

## Architecture

**Chrome Extension (MV3) + Python Proxy Server**

```
dropshit/
├── extension/
│   ├── background.js          — Service worker; orchestrates the full analysis pipeline
│   ├── content.js             — Content script (minimal)
│   ├── popup.js / popup.html / styles.css  — Popup UI (4-state machine: idle → loading → result → error)
│   ├── manifest.json          — MV3 manifest
│   ├── icons/
│   ├── pipeline/
│   │   ├── prompts.js         — All LLM system/user prompts
│   │   └── combiner.js        — Text-branch dropship detection orchestrator
│   ├── services/              — Individual async analysis steps
│   │   ├── analyzeImages.js
│   │   ├── analyzeDropshipWithAI.js
│   │   ├── braveSearch.js
│   │   ├── generateSearchQueries.js
│   │   ├── imageReverseSearch.js
│   │   ├── prepareReverseSearchCandidateForAI.js
│   │   └── synthesiseVerdict.js
│   └── util/
│       └── loadEnv.js         — .env loader for Node.js
└── backend/
    └── proxy.py               — Flask server on localhost:3000; bridges extension to external APIs
```

## Running Locally

1. **Start the proxy server:**
   ```bash
   python backend/proxy.py
   # Serves on http://localhost:3000
   ```

2. **Load the extension** in Chrome: Settings → Extensions → Load unpacked → select `extension/`

No build step required (pure ES6 modules).

## Environment Variables

Copy `.env.example` to `.env` and fill in:
- `CRUSOE_KEY` — Crusoe Cloud (runs Qwen3-235B for all LLM calls)
- `BRAVE_SEARCH_KEY` — Brave Search API
- `SERP_API_KEY` — SerpAPI (Google Lens reverse image search)

## Analysis Pipeline

1. Extract product data from active tab DOM (LLM extractor)
2. **Text branch**: compute dropship signals → generate search queries → Brave Search → Qwen analysis (`combiner.js`)
3. **Image branch** (parallel): reverse image search via SerpAPI → vision comparison with Qwen (`analyzeImages.js`)
4. **Synthesis**: Qwen combines all evidence into a unified verdict (`synthesiseVerdict.js`); confidence ≥ 0.90 required
5. Map result: markup %, source URL, savings — persist totals to `chrome.storage`

## Key Conventions

- All LLM calls return **strict JSON** (no markdown, no code blocks); temperature = 0.1
- Prompts live in `extension/pipeline/prompts.js`
- Services are isolated async functions; errors trigger fallback logic
- Popup communicates with service worker via `chrome.runtime.connect()` ports

## Python Dependencies

Managed with `uv` (Python 3.13+). Packages: Flask, Flasgger, Requests, python-dotenv.
