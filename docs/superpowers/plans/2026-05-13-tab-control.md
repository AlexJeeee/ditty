# Tab Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add model-driven Chrome tab and tab-group controls through the existing confirmable AgentAction pipeline.

**Architecture:** Add one `manage_tabs` model tool that produces typed `AgentAction` objects. Execute browser-level operations in `src/background/action-executors.ts` with `chrome.tabs` and `chrome.tabGroups`, while reusing the side panel's existing confirmation/result flow.

**Tech Stack:** Chrome MV3 APIs, TypeScript, OpenAI chat tools, Vitest.

---

### Task 1: Model Tool Contract

**Files:**

- Modify: `src/shared/types.ts`
- Modify: `server/model-tools.ts`
- Test: `server/model-tools.test.ts`

- [ ] Add failing tests for `manage_tabs` operations: list, switch, close, create group, update group, move to group, ungroup.
- [ ] Extend shared action types with tab operation input fields and tab-group colors.
- [ ] Add `manage_tabs` schema and argument validation in `server/model-tools.ts`.
- [ ] Verify `pnpm vitest run server/model-tools.test.ts` passes for the new tests.

### Task 2: Browser Executors

**Files:**

- Modify: `src/background/action-executors.ts`
- Modify: `manifest.config.ts`

- [ ] Add `tabGroups` permission and remove duplicate `activeTab`.
- [ ] Implement `manage_tabs` execution with focused helpers per operation.
- [ ] Return structured tab/group snapshots in action results so the model can use concrete ids later.
- [ ] Keep unsupported or malformed operations blocked with a user-readable message.

### Task 3: Verification and Docs

**Files:**

- Modify: `docs/main-flow.md`
- Modify: `README.md` only if needed to reflect discoverability.

- [ ] Update developer docs for the new browser-level action surface.
- [ ] Run `pnpm vitest run server/model-tools.test.ts`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm server:typecheck`.
