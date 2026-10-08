# Rewatch Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Expose explicit rewatch operations and open a PR closing #10.

**Architecture:** A token-scoped RewatchService handles eligibility and history requests. A focused tool registration module owns strict input schemas and registers the existing stop tool with explicit opt-in and raw upstream responses; the generator excludes its duplicate stop registration.

**Tech Stack:** TypeScript, Zod, Bun tests, Cloudflare MCP agent.

**Spec:** ../specs/2026-10-08-rewatch-sessions-design.md

## Global Constraints
- Existing history and watchlist calls retain their default behavior.
- Never enable rewatch opt-in on scrobble start/pause.
- Require PRO/VIP for opted-in writes; cache eligibility for five minutes within the current token scope.
- Require a positive integer rewatch_id for session updates.
- Preserve raw upstream statuses; never infer successful saving from an ID alone.
- No automatic retries of session-creating writes; no live history mutations.

## Review Focus
- A token change must not inherit another account's eligibility.
- An ambiguous network failure must not cause a second POST.
- A too_soon response containing an ID must not be reported as saved.
- A TV/anime completed request must be rejected locally rather than silently closing the session.
- Summary-only reading must not be confused with zero recorded episodes.

### Task 1: Runtime baseline and upstream contract
**Files:** inspect package.json, generated/simkl-openapi3.json, specs/apiary.apib; create a narrow upstream contract fixture under tests/fixtures if official schema access succeeds.
**Interfaces:** produces a verified endpoint/field mapping used by Tasks 2–3.
- [x] Make Bun available through an allowed package source; run `bun test` and `bun run typecheck`. Record baseline failures before changes.
- [x] Retrieve official OpenAPI through supported browsing/network tools; inspect history, all-items, scrobble stop and settings. The OpenAPI JSON endpoint was inaccessible in the browser tool; verified endpoint contracts against the official rewatch/mark-watched guides and local generated APIary OpenAPI.
- [x] Inspect local instructions and branch/remotes. Implementation is isolated on the feature branch `codex/issue-10-rewatch-sessions`.

### Task 2: Rewatch request service
**Files:** create src/api/rewatches.ts and tests/rewatches.test.ts.
**Interfaces:** RewatchService(client: SimklClient, getToken: () => string | undefined, now?: () => number) exposes start(input), update(input), list(input), stop(input), returning upstream JSON unchanged. The focused tool registration registers four tools: three rewatch tools and the replacement stop tool.
- [x] Write failing mocked-HTTP tests for movie/show/anime history serialization, is_rewatch=true, pinned IDs and stable timestamps.
- [x] Add tests for pro/vip/free/missing account type, five-minute expiry, token changes, settings errors and pro_required cache invalidation.
- [x] Add tests preserving lifecycle and upstream response statuses, including too_soon with an ID. Assert exactly one POST after an ambiguous network failure.
- [x] Add read tests asserting allow_rewatch=yes, extended=full, episode_watched_at=yes, date_from and preserved canonical/rewatch rows.
- [x] Run `bun test tests/rewatches.test.ts` and confirm failures; implement the service, rerun to green, and commit.

### Task 3: Discoverable tools and safe scrobbling
**Files:** create src/tools/rewatches.ts and tests/rewatch-tools.test.ts; modify src/mcp-agent.ts, src/tools-config.ts, scripts/codegen.ts; regenerate generated/tools.ts.
**Interfaces:** registerRewatchTools(server, service) registers simkl_start_rewatch, simkl_update_rewatch and simkl_get_rewatches. Existing generated stop accepts optional explicit rewatch intent and shares the agent's RewatchService.
- [x] Write failing registration/handler tests for required IDs and update IDs, and reject invalid lifecycle transitions.
- [x] Test read omission of date_from requires initial_sync=true; normal reads require date_from.
- [x] Test default stop sends no rewatch query/settings request; explicit stop below 80 rejects before writing; explicit stop at 80+ invokes gating and preserves raw JSON. Start/pause remain unchanged and cannot opt in.
- [x] Implement strict schemas and register tools once per agent. Modify generation inputs rather than editing generated output. Mutation annotations are not readOnly/idempotent.
- [x] Regenerate with `bun run scripts/codegen.ts`; run focused tests and typecheck; commit.

### Task 4: Documentation, verification and PR
**Files:** update README.md and planning checklist.
**Interfaces:** produces the final feature branch and PR containing Closes #10.
- [x] Document tool behavior, explicit opt-in, plan gating, canonical/session distinction, full-detail read flags, two-day gap, fifty-session limit and retry reconciliation.
- [x] Run all tests, typecheck, generation and `git diff --check`. Focused rewatch tests pass (12/12); typecheck and generation pass. Full suite has 40 passing and 6 pre-existing AUTH V2/OAuth failures, reproduced from baseline. Inspect the complete diff before PR.
- [ ] Commit final changes, push the feature branch and create a PR with concise behavior/validation notes and Closes #10. Do not merge or deploy.
