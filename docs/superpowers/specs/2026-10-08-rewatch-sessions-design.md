# Explicit Simkl rewatch sessions

## Goal and compatibility
Implement issue #10 as discoverable, explicitly requested movie, TV and anime rewatch operations. Existing history and watchlist calls retain their default behavior. No background activity enables rewatch tracking. The PR will include `Closes #10`.

## Architecture
Add `src/api/rewatches.ts` for validated request construction, account eligibility and response handling, with tool registration in a focused module wired into `src/mcp-agent.ts`. Reuse SimklClient and return structured MCP errors from the focused tool module. Maintain the existing generated tools; route stop through the focused tool and exclude its duplicate generated registration. Never hand-edit generated output.

## Tool contracts
- `simkl_start_rewatch`: one explicitly selected movie/show/anime with IDs, optional watched_at and episode timestamps, and optional pinned rewatch_id/status to resume a session. Send POST /sync/history with allow_rewatch=yes and per-item is_rewatch=true. Return the complete upstream response and any session identifiers/statuses without inventing a success result. The operation may reuse an existing active session.
- `simkl_update_rewatch`: require a positive integer rewatch_id and the same media identity; accept episode updates and optional active/closed state. Movies may also request completed; TV/anime completion is earned upstream. Pin rewatch_id on every update.
- `simkl_get_rewatches`: GET /sync/all-items with allow_rewatch=yes, extended=full and episode_watched_at=yes. Accept media/status filters and date_from; permit omission of date_from only with explicit initial_sync intent. Return canonical and session rows with their upstream is_rewatch distinction preserved.
- `simkl_stop_watching`: optional explicit rewatch intent, default false. Only a stop with progress >=80 can opt in; never propagate opt-in to start/pause. Preserve the upstream JSON response including action, rewatch_status and rewatch_id. Checkin is outside this PR because no current checkin tool exists.

## Eligibility and lifecycle
Before opted-in writes, read GET /users/settings and require account.type pro or vip. Cache for five minutes within the authenticated tool service; scope cached state to the current token and discard it on token changes. Failed or unknown eligibility must not authorize writes. Invalidate cache on upstream pro_required.

Upstream session states are active, closed and completed. Preserve first_watch, too_soon, not_eligible, pro_required and null outcomes; an ID alone does not prove a watch was saved. Free-tier history no-ops must not produce a success confirmation. Simkl owns the two-day gap and fifty-session limit; document them and preserve responses rather than implementing a competing local state machine. Do not automatically retry session-creating writes, especially after ambiguous network failures; advise reading sessions before an explicit retry. Keep caller timestamps stable.

## Schema and generation
Compare the official OpenAPI at https://api.simkl.org/openapi.json with the guide at https://api.simkl.org/guides/rewatches before implementing contracts. Record any access or schema limitation. Avoid a wholesale generator migration that changes unrelated tools; use focused validated schemas for rewatch operations and regenerate affected tools reproducibly.

## Verification
Use Bun tests with mocked upstream HTTP to verify query/body separation, timestamps, session ID pinning, PRO/VIP/free and unknown-plan behavior, cache expiry/token isolation, lifecycle responses, no success inferred from ID, fifty-session and too-soon responses, and no automatic mutation retries. Tool-level tests cover schema rejection, explicit intent, scrobble progress gating and unchanged defaults. Run all tests, TypeScript checking and regeneration consistency. No live account history mutations are required.

## Delivery
Update README with opt-in examples, read flags, plan requirements, session transitions and retry caveats. Produce a feature branch and PR closing #10 after implementation and review. No merge or deployment is requested.
