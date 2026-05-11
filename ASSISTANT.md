# ASSISTANT.md

This file provides guidance to the assistant (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev             # Start extension dev server (CRXJS/Vite, fixed port 5173)
pnpm server:dev      # Start local AI proxy (tsx watch, default port 8787)
pnpm dev:all         # Start both concurrently

pnpm build           # vue-tsc type check + Vite production build → dist/
pnpm typecheck       # Vue/TS type check (extension)
pnpm server:typecheck # TS type check (server)

pnpm test            # Run tests once (vitest)
pnpm test:watch      # Run tests in watch mode
```

After refactoring or deleting files, run the stricter checks:

```bash
pnpm exec vue-tsc --noEmit --noUnusedLocals --noUnusedParameters
pnpm exec tsc --noEmit -p server/tsconfig.json --noUnusedLocals --noUnusedParameters
```

Test files live alongside source: `src/shared/url-action.test.ts`, `src/side-panel/stores/agent-run-messages.test.ts`.

## Architecture Overview

This is a **Chrome MV3 extension** with a **local Fastify proxy** that calls any OpenAI-compatible Chat Completions API. The model API key never touches the extension frontend.

```
Side Panel (Vue 3)  ←→  Service Worker  ←→  Content Script (page DOM)
      ↓
Local Fastify Server  →  OpenAI-compatible Provider
```

### Runtime message flow

1. User submits a task in the Side Panel.
2. Side Panel asks the Service Worker for page context → Service Worker asks Content Script → Content Script extracts DOM data and returns `PageContext`.
3. Side Panel POSTs to local server: `POST /api/agent/runs` then subscribes `POST /api/agent/runs/:runId/stream` (SSE).
4. Server calls the model, streams `AgentRunEvent`s back (status, message_delta, plan, action_request, …).
5. For actions requiring confirmation, the Side Panel shows inline confirm/skip cards. On confirm, Side Panel sends `agent_action:execute` to Service Worker → Content Script performs the whitelisted DOM action.
6. `open_url` is a browser-level action handled in `src/background/action-executors.ts` (opens a new tab via `chrome.tabs.create`).

### Extension source layout

| Path                                            | Role                                                                              |
| ----------------------------------------------- | --------------------------------------------------------------------------------- |
| `src/background/service-worker.ts`              | Extension lifecycle, message routing, tab events                                  |
| `src/background/action-executors.ts`            | Browser-level actions (e.g. `open_url`)                                           |
| `src/content/index.ts`                          | Content script entry; wires up collection and selection menu                      |
| `src/content/collect-page-context.ts`           | Extracts visible text, headings, tables, interactive elements                     |
| `src/content/element-registry.ts`               | In-memory `elementId` → DOM element map (per page lifecycle)                      |
| `src/content/execute-action.ts`                 | Whitelisted DOM action executor                                                   |
| `src/content/risk-detector.ts`                  | Local risk classification for actions                                             |
| `src/content/selection-menu.ts`                 | Floating menu on text selection                                                   |
| `src/shared/types.ts`                           | Single source of truth for all shared types (AgentAction, PageContext, events, …) |
| `src/shared/extension-messages.ts`              | Typed `chrome.runtime` message union                                              |
| `src/shared/api-client.ts`                      | Fetch wrapper for the local proxy API                                             |
| `src/shared/id.ts`                              | `createScopedId()` — use this everywhere instead of ad-hoc `Date.now()`           |
| `src/side-panel/stores/agent-run.ts`            | Agent run orchestration, API calls, stop, action dispatch                         |
| `src/side-panel/stores/agent-run-messages.ts`   | Pure logic: message creation, event application, action message state             |
| `src/side-panel/stores/page-context.ts`         | Pinia store for current tab's `PageContext`                                       |
| `src/side-panel/stores/auth.ts`                 | Demo-only auth state                                                              |
| `src/side-panel/components/ChatPanel.vue`       | Chat area shell and auto-scroll                                                   |
| `src/side-panel/components/ChatComposer.vue`    | Input box, send and stop                                                          |
| `src/side-panel/components/ChatMessageItem.vue` | Single message rendering: plan, thinking blocks, action confirm cards             |

### Server layout

| Path                     | Role                                                                                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/index.ts`        | Fastify init, CORS, route registration, listen                                                                                                           |
| `server/config.ts`       | Env vars: port, model, timeout, retries, base URL                                                                                                        |
| `server/agent-routes.ts` | `GET /health`, `GET /health/openai`, `GET /api/models`, `POST /api/agent/runs`, `POST /api/agent/runs/:runId/stream`, `POST /api/agent/runs/:runId/stop` |
| `server/run-store.ts`    | In-memory run state + active stream management + context trimming                                                                                        |
| `server/agent-prompt.ts` | System prompt and default plan construction                                                                                                              |
| `server/model-tools.ts`  | OpenAI tool definitions, streaming tool-call accumulation, action generation                                                                             |
| `server/sse.ts`          | SSE event writing helpers                                                                                                                                |

## Key Conventions

- **`src/shared/types.ts` owns all cross-boundary types.** Extension messages, server API types, and action types all import from here. Do not duplicate type definitions.
- **`elementId` are ephemeral.** The Content Script's `ElementRegistry` only persists for the current page lifecycle. If the URL changes or the DOM is significantly mutated, a fresh `PageContext` must be collected before any element-targeted action.
- **Action risk gates** (in `src/content/risk-detector.ts` and enforced in `src/content/execute-action.ts`):
  - `low` — execute immediately.
  - `medium` — requires inline user confirmation in the chat.
  - `high` — always blocked.
- **SSE channel field on `message_delta`**: `"thinking"` renders as a collapsible thinking block; `"answer"` is the main chat bubble. Accumulate deltas by `messageId`.
- **`agent-run.ts` vs `agent-run-messages.ts`**: Keep side-effect-free message/event logic in `agent-run-messages.ts`; keep API calls, timers, and Chrome runtime calls in `agent-run.ts`.
- **Port 5173 is fixed** (`strictPort: true` in `vite.config.ts`) because CRXJS hard-codes the HMR websocket URL into the built extension. Changing the port requires rebuilding and reloading the extension.

## Environment Variables

Copy `.env.example` to `.env`. Required at minimum:

```
AI_MODEL_PROVIDERS_JSON=[{"id":"minmax","name":"MiniMax","baseURL":"https://api.minimaxi.com/v1","apiKeyEnv":"MINIMAX_API_KEY","models":[{"id":"MiniMax-M2.7","name":"MiniMax M2.7"}]},{"id":"deepseek","name":"DeepSeek","baseURL":"https://api.deepseek.com/v1","apiKeyEnv":"DEEPSEEK_API_KEY","models":[{"id":"deepseek-chat","name":"DeepSeek Chat"}]}]
AI_DEFAULT_PROVIDER=minmax
AI_DEFAULT_MODEL=MiniMax-M2.7
MINIMAX_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
OPENAI_TIMEOUT_MS=120000
OPENAI_MAX_RETRIES=1
AI_AGENT_PORT=8787
VITE_AGENT_API_BASE_URL=http://127.0.0.1:8787  # consumed by extension frontend
```

`VITE_AGENT_API_BASE_URL` is the only env var that goes into the extension bundle. All model secrets stay server-side.
If `AI_MODEL_PROVIDERS_JSON` is absent, the server falls back to the legacy single-provider `OPENAI_BASE_URL` / `OPENAI_API_KEY` / `OPENAI_MODEL` configuration.

## Loading the Extension in Chrome

1. Run `pnpm dev:all` (keeps `dist/` up to date via CRXJS).
2. Open `chrome://extensions` → enable Developer mode.
3. "Load unpacked" → select the `dist/` directory.
4. After background/manifest changes, click the refresh icon on the extension card.
5. After content script changes, reload the target tab.
