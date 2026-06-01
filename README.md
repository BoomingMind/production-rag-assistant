# Agentic RAG Assistant — LangChain · LangGraph · LangSmith

A portfolio demo of a production-shaped **agentic RAG** application. A LangGraph
agent answers questions by combining **retrieval over your own documents** with
**live web search**, streams its tokens *and* its intermediate steps to a polished
React UI, and is fully instrumented with **LangSmith** tracing and offline
evaluations.

```
┌────────────┐    SSE (tokens · steps · sources)    ┌──────────────────────────┐
│  React 19  │  ◀───────────────────────────────────│  FastAPI  /api/chat/stream│
│  (Vite 8,  │  ──── POST {message, thread_id} ────▶ │                          │
│ Tailwind 4)│                                       │  LangGraph create_agent  │
└────────────┘                                       │   ├─ retrieve_documents  │ ── Chroma (RAG)
                                                      │   └─ web_search          │ ── Tavily / DuckDuckGo
                                                      │  AsyncSqliteSaver memory │
                                                      └──────────┬───────────────┘
                                                                 │ auto-traced
                                                                 ▼
                                                          LangSmith (traces,
                                                          datasets, evals)
```

## What it demonstrates

| Technology | Where |
|---|---|
| **LangGraph** | `create_agent` ReAct loop (plan → tools → synthesize), `AsyncSqliteSaver` thread memory, multi-mode `astream` (`messages`/`updates`/`custom`) → SSE |
| **LangChain** | RAG pipeline: loaders → `RecursiveCharacterTextSplitter` → `text-embedding-3-small` → Chroma; retriever + web-search tools |
| **LangSmith** | zero-code tracing of every run, a programmatic eval dataset, and an `evaluate()` experiment with LLM-as-judge + RAG metrics + a pairwise comparison |
| **Frontend** | React 19 + TypeScript + Tailwind v4, POST-SSE streaming hook, live agent-activity timeline, citation chips, drag-and-drop ingestion, dark mode |

Models are OpenAI **gpt-5 series** (`gpt-5.4-mini` for routine steps, `gpt-5.5`
for synthesis). Embeddings: `text-embedding-3-small`.

## Project layout

```
src/rag_agent/      FastAPI app + LangGraph agent (config, llms, tools, agent, streaming, api)
frontend/           React 19 + Vite + Tailwind v4 UI
evals/              LangSmith dataset + evaluation scripts
data/sample_docs/   Demo documents (the fictional "Aurora" platform) auto-ingested on first boot
docker-compose.yml  backend (uvicorn) + frontend (nginx, single-origin /api proxy)
```

## Setup

```bash
cp .env.example .env     # then fill in the keys
```

Required: `OPENAI_API_KEY`. Recommended: `TAVILY_API_KEY` (web search; falls back
to keyless DuckDuckGo if absent) and the `LANGSMITH_*` vars (tracing + evals).

## Run with Docker (recommended)

```bash
docker compose up -d --build      # OPENAI_API_KEY must be set in your shell
docker compose ps                 # check both services are up
# UI:      http://localhost:8080
# API:     http://localhost:8000/api/health
docker compose logs -f backend    # follow logs
docker compose down               # stop
```

The frontend container serves the built UI and proxies `/api` to the backend, so
everything is single-origin (no CORS).

## Run locally (dev)

Backend:
```bash
uv sync
uv run uvicorn rag_agent.api:app --reload   # http://localhost:8000
```

Frontend (separate terminal):
```bash
cd frontend
npm install
npm run dev                                  # http://localhost:5173 (proxies /api → :8000)
```

On first boot the backend ingests `data/sample_docs/` into a persisted Chroma
store. Upload your own PDFs/TXT/Markdown via the **Upload docs** button.

## API

| Method | Path | Description |
|---|---|---|
| `GET`  | `/api/health` | models, web backend, tracing flag, indexed-chunk count |
| `POST` | `/api/ingest` | multipart upload → `{chunks_added, files}` |
| `POST` | `/api/chat/stream` | SSE stream of `start` / `token` / `tool_start` / `tool_end` / `sources` / `error` / `end` |
| `POST` | `/api/feedback` | forward a thumbs up/down score to LangSmith |

Quick stream check:
```bash
curl -N -X POST http://localhost:8000/api/chat/stream \
  -H 'Content-Type: application/json' \
  -d '{"message":"What auth does Aurora use, and what is mTLS? Cite sources."}'
```

## Observability & Evaluation with LangSmith

Tracing turns on automatically when `LANGSMITH_TRACING=true` and `LANGSMITH_API_KEY`
are set — every LLM call, tool call, and graph node is captured as a nested trace.

```bash
uv run python -m evals.create_dataset   # seed the "resume-demo-rag-qa" dataset
uv run python -m evals.run_evals        # run the experiment; prints the results URL
uv run python -m evals.run_pairwise     # (bonus) gpt-5.5 vs gpt-5.4-mini, side-by-side
```

`run_evals` scores each answer with four evaluators:

- **correctness** — openevals LLM-as-judge vs the reference answer
- **groundedness** — is the answer supported by the retrieved context (RAG faithfulness)
- **retrieval_relevance** — was the retrieved context relevant to the question
- **cites_sources** — heuristic check that the answer actually cites something

Open the printed experiment URL in the LangSmith UI: the table shows one row per
example with a column per metric; click any row to open the full agent trace
(tool calls, token usage, latency). `run_pairwise` produces a comparison view.

## Notes

- Web search uses **Tavily** when a key is present, else keyless **DuckDuckGo**
  (best-effort; rate-limited).
- Reasoning models route through the OpenAI Responses API; `max_tokens` is left
  unset so reasoning tokens don't truncate the answer.
- Tool start/end events are taken from the `updates` stream channel (reliable);
  answer tokens from `messages`; retrieved sources from a `custom` channel.
- Conversation memory is keyed by `thread_id` via LangGraph's `AsyncSqliteSaver`.
