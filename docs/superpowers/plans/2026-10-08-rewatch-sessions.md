# Rewatch Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Expose explicit rewatch operations and open a PR closing #10.

**Architecture:** A token-scoped RewatchService handles eligibility and history requests. A focused tool registration module owns strict input schemas; generated scrobble stop delegates to the shared service only on explicit intent.

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
- [ ] Make Bun available through an allowed package source; run `bun test` and `bun run typecheck`. Record baseline failures before changes.
- [ ] Retrieve official OpenAPI through supported browsing/network tools; inspect history, all-items, scrobble stop and settings. If unavailable, record the exact limitation and verify against the official guide; do not claim schema verification succeeded.
- [ ] Inspect local instructions and branch/remotes. Use the current cloud checkout on a feature branch to keep the PR reviewable; avoid unnecessary nested worktrees.

### Task 2: Rewatch request service
**Files:** create src/api/rewatches.ts and tests/rewatches.test.ts.
**Interfaces:** RewatchService(client: SimklClient, getToken: () => string | undefined, now?: () => number) exposes start(input), update(input), list(input), stop(input), returning upstream JSON unchanged.
- [ ] Write failing mocked-HTTP tests for movie/show/anime history serialization, is_rewatch=true, pinned IDs and stable timestamps.
- [ ] Add tests for pro/vip/free/missing account type, five-minute expiry, token changes, settings errors and pro_required cache invalidation.
- [ ] Add tests preserving active/closed/completed and first_watch/too_soon/not_eligible/null responses, including too_soon with an ID; retain upstream session-limit response. Assert exactly one POST after an ambiguous network failure.
- [ ] Add read tests asserting allow_rewatch=yes, extended=full, episode_watched_at=yes, date_from and preserved canonical/rewatch rows.
- [ ] Run `bun test tests/rewatches.test.ts` and confirm failures; implement the service, rerun to green, and commit.

### Task 3: Discoverable tools and safe scrobbling
**Files:** create src/tools/rewatches.ts and tests/rewatch-tools.test.ts; modify src/mcp-agent.ts, src/tools-config.ts, scripts/codegen.ts; regenerate generated/tools.ts.
**Interfaces:** registerRewatchTools(server, service) registers simkl_start_rewatch, simkl_update_rewatch and simkl_get_rewatches. Existing generated stop accepts optional explicit rewatch intent and shares the agent's RewatchService.
- [ ] Write failing registration/handler tests rejecting absent identity, nonpositive/fractional IDs, invalid timestamps, missing update ID and TV/anime completed transitions.
- [ ] Test read omission of date_from requires initial_sync=true; normal reads require date_from.
- [ ] Test default stop sends no rewatch query/settings request; explicit stop below 80 rejects before writing; explicit stop at 80+ invokes gating and preserves raw JSON. Confirm start/pause cannot opt in.
- [ ] Implement strict schemas and register tools once per agent. Modify generation inputs rather than editing generated output. Ensure mutation annotations are not readOnly/idempotent.
- [ ] Regenerate with `bun run scripts/codegen.ts`; run focused tests and typecheck; commit.

### Task 4: Documentation, verification and PR
**Files:** update README.md and planning checklist.
**Interfaces:** produces the final feature branch and PR containing Closes #10.
- [ ] Document each tool with movie and episodic examples, explicit opt-in, plan gating, canonical/session distinction, full-detail read flags, two-day gap, fifty-session limit and reconciliation before retry.
- [ ] Run all tests, typecheck, generation consistency and `git diff --check`. Inspect the complete diff for scope, defaults, token isolation, annotations and status handling; correct findings and rerun affected checks.
- [ ] Commit final changes, push the feature branch and create a PR with concise behavior/validation notes and Closes #10. Do not merge or deploy.
