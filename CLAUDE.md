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
    ├── proxy.py               — Flask server on localhost:3000; bridges extension to external APIs
    └── db.py                  — ChromaDB vector store; product cluster matching and sighting records
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
- `OPENAI_EMBED_KEY` — OpenAI API key scoped to embeddings (`text-embedding-3-small`)

## Analysis Pipeline

1. Extract product data from active tab DOM (LLM extractor)
2. **DB cache lookup**: describe `product.main_image` via Qwen vision → embed with OpenAI → cosine search in `product_clusters_v2`; if similarity ≥ 0.87, skip to step 6 with cached result
3. **Text branch**: compute dropship signals → generate search queries → Brave Search → Qwen analysis (`combiner.js`)
4. **Image branch** (parallel): reverse image search via SerpAPI → vision comparison with Qwen (`analyzeImages.js`)
5. **Synthesis**: Qwen combines all evidence into a unified verdict (`synthesiseVerdict.js`); confidence ≥ 0.90 required
6. Map result: markup %, source URL, savings — persist totals to `chrome.storage`
7. **DB record**: write detection to ChromaDB (`POST /db/record`); `detectionCount` returned and shown in popup

## Vector Database (ChromaDB)

Persists to `./backend/data/chroma`. Two collections:

- **`product_clusters_v2`** — one entry per canonical wholesale product; tracks detection count, avg markup, price range, retailer domains
- **`product_sightings_v2`** — one entry per detection event; full audit log

**Embedding strategy**: product image → Qwen vision description (2-3 sentences) → `text-embedding-3-small` (1536-dim). Falls back to `"{title} {tags}"` text if image is unreachable.

**Matching on record**: exact `wholesale_url` match first; then embedding cosine similarity ≥ 0.85.

**Cache lookup threshold**: 0.87 (uses retail image since wholesale URL is not yet known).

Proxy routes: `POST /db/lookup`, `POST /db/record`.

## Key Conventions

- All LLM calls return **strict JSON** (no markdown, no code blocks); temperature = 0.1
- Prompts live in `extension/pipeline/prompts.js`
- Services are isolated async functions; errors trigger fallback logic
- Popup communicates with service worker via `chrome.runtime.connect()` ports
- DB calls in `background.js` are non-fatal: failures log a warning and default gracefully

## Python Dependencies

Managed with `uv` (Python 3.13+). Packages: Flask, Flasgger, Requests, python-dotenv, chromadb, openai.
