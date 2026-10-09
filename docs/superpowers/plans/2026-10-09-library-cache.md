# Per-user Library Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans for native execution, or superpowers:subagent-driven-development if the user chooses delegation. Execute task by task; checkbox steps track progress.

**Goal:** Implement issue #13's persistent per-account library initialization and open a PR containing `Closes #13`.

**Architecture:** A verified identity resolver selects one SQLite Durable Object per Simkl account. That object performs and coalesces upstream initialization, then commits separate item rows and activities metadata synchronously. A service exposes the foundation for #14 and #15; existing watchlist output remains outside this issue.

**Tech Stack:** TypeScript, Cloudflare Workers/Durable Objects SQLite, Bun tests, Wrangler.

**Spec:** `docs/superpowers/specs/2026-10-09-library-cache-design.md` (approved with the user's six additions).

## Global Constraints

- New OAuth authorizations persist verified raw `simklUserId`; UUID fallbacks never address cache objects.
- Initialization API calls run inside the Durable Object operation, with no persisted token.
- Activities first, then shows/movies/anime sequentially, without `extended` or `date_from`.
- Only HTTP 400 with `upstreamCode === 'max_items'` triggers five sequential status pulls.
- Default responses: `2 * 1024 * 1024` bytes; successful allowlisted library pulls: `16 * 1024 * 1024` bytes.
- Pending serialized items: at most `32 * 1024 * 1024` bytes; individual stored JSON: at most `1024 * 1024` UTF-8 bytes.
- Network, validation, and serialization precede a synchronous storage transaction; items and completion metadata commit together.
- Do not implement #14/#15, upgrade unrelated dependencies, or deploy production.

## Review Focus

- Legacy or malformed identity must fail before object selection; lookup rejection must permit a later retry (Task 1).
- Chunked/multibyte responses must obey byte caps without trusting Content-Length (Task 2).
- Empty media arrays must initialize successfully; malformed or conflicting duplicate IDs must not create completion (Task 3).
- A rejected concurrent attempt must release coordination so a later valid token can retry (Task 4).
- Object reconstruction and real SQL rollback must preserve completion invariants, including metadata insert failure (Tasks 4–5).

## File Map

- Modify `src/auth-handler.ts`, `src/auth/simkl-oauth.ts`: persist verified ID during authorization.
- Create `src/library/identity.ts`: normalize/resolve stable identity.
- Modify `src/api/client.ts`: endpoint-scoped body profile and sanitized max_items code.
- Create `src/library/types.ts`: cache records and initialization result types.
- Create `src/library/sync.ts`: sequential initial pulls and validation.
- Create `src/library/store.ts`: SQL schema/read/atomic commit.
- Create `src/library/cache.ts`: exported Durable Object and coordination.
- Create `src/library/service.ts`: session identity lookup and object access.
- Modify `src/index.ts`, `wrangler.toml`, `worker-configuration.d.ts`, `README.md`: runtime binding, migration, and documentation.
- Add focused tests under `tests/library-*.test.ts`; extend existing auth/client/provider tests.

### Task 1: Verified identity and OAuth persistence

**Files:** `src/library/identity.ts`, `src/auth-handler.ts`, `src/auth/simkl-oauth.ts`, `tests/library-identity.test.ts`, `tests/auth-handler.test.ts`, `tests/oauth-provider.test.ts`.

**Interfaces:** Produce `normalizeSimklId(value: unknown): string | undefined`, `resolveSimklUserId(client: SimklClient, token: string, knownId?: string): Promise<string>`, and optional `simklUserId: string` on shared `SimklAuthProps`. Normalization accepts positive safe-integer numbers and positive decimal strings; canonicalize leading zeros. Resolver returns known canonical ID or authenticated settings ID, and throws a sanitized error on failure.

- [ ] Add failing assertions for `normalizeSimklId(42) === '42'`, `'00042' === '42'`, and rejection of `0`, negative/fractional/unsafe numbers, UUIDs, `simkl_user_42`, empty strings and objects. Assert resolver makes no fetch for known ID, retries after rejected lookup, and never returns the provider UUID.
- [ ] Extend OAuth tests to assert `props.simklUserId === '42'` on successful settings fetch, absent verified prop on failed lookup, and preservation through refresh.
- [ ] Run `bun test tests/library-identity.test.ts tests/auth-handler.test.ts tests/oauth-provider.test.ts`; confirm the new assertions fail before implementation.
- [ ] Implement the exported helpers and shared props. Reuse normalization during login, preserving the current provider userId fallback separately. Preserve existing OAuth flow and sanitized errors.
- [ ] Run those tests; expect all pass. Commit as `feat: retain verified Simkl account identity`.

### Task 2: Library response profile and max_items classification

**Files:** `src/api/client.ts`, `tests/api-client.test.ts`, `tests/api-error.test.ts`.

**Interfaces:** Extend `RequestOptions` with optional `responseProfile: 'library'`. A successful allowlisted relative GET library path uses the larger cap; all other requests retain the default cap. Extend `SimklApiError.upstreamCode` with `max_items` using existing sanitized parsing.

- [ ] Add failing tests: a valid library JSON body above 2 MiB succeeds with profile, the same body without profile fails, unrelated/absolute/POST requests cannot gain the larger limit, and non-success responses keep the default cap. Assert a 400 `{"error":"max_items"}` yields `upstreamCode === 'max_items'`; other 400 values do not.
- [ ] Add byte-boundary tests: exactly selected cap succeeds; cap+1 fails; misleading/missing Content-Length does not bypass limits; multibyte input is counted as bytes; stream cancellation occurs on overflow; fallback UTF-8 measurement rejects overlimit bodies.
- [ ] Run `bun test tests/api-client.test.ts tests/api-error.test.ts`; confirm expected failures.
- [ ] Implement endpoint/method/status gating and checks before chunk decode/append. Retain sanitized error handling and existing request signatures.
- [ ] Run those tests; expect pass. Commit as `feat: bound large library responses and detect max_items`.

### Task 3: Sequential initialization fetch and validation

**Files:** `src/library/types.ts`, `src/library/sync.ts`, `tests/library-sync.test.ts`.

**Interfaces:** Produce `MediaType = 'shows' | 'movies' | 'anime'`, `LibraryItemRow = { mediaType: MediaType; simklId: string; itemJson: string }`, `LibraryCandidate = { activities: Record<string, unknown>; items: LibraryItemRow[] }`, `LibraryInitialization = { initialized: true; itemCount: number }`, and `fetchInitialLibrary(client: SimklClient, accessToken: string): Promise<LibraryCandidate>`.

- [ ] Add a deferred-fetch test asserting request order exactly activities/shows/movies/anime, with at most one request active. Assert no `extended`/`date_from`, preserved `user_rating` and optional fields, and no separate ratings fetch.
- [ ] Add fallback tests expecting the failed media request followed by watching/plantowatch/hold/completed/dropped, then remaining media types. Assert 400 without max_items never splits and a split failure stops all later calls.
- [ ] Add tests for empty arrays, missing arrays, invalid activities.all, missing/wrong media identity, identical duplicates collapsing, conflicting duplicates rejecting, a >1 MiB item rejecting, and aggregate >32 MiB serialized item JSON rejecting before any commit.
- [ ] Run `bun test tests/library-sync.test.ts`; confirm failures for absent implementation.
- [ ] Implement fetch/validation/serialization with Task 1 normalization, Task 2 response profile, sequential loops, and bounded accumulation. Keep network-free data ready for the store transaction.
- [ ] Run those tests; expect pass. Commit as `feat: fetch and validate initial Simkl library`.

### Task 4: SQLite persistence and object-owned coordination

**Files:** `src/library/store.ts`, `src/library/cache.ts`, `tests/library-store.test.ts`, `tests/library-cache.test.ts`, `tests/helpers/library-storage.ts`.

**Interfaces:** `LibraryStore(storage: DurableObjectStorage)` exposes `getInitialization(): LibraryInitialization | null`, `commit(candidate: LibraryCandidate): LibraryInitialization`, and `readItems(): LibraryItemRow[]`. `SimklLibraryCache` exposes RPC `ensureInitialized(accessToken: string): Promise<LibraryInitialization>` and `readItems(): Promise<LibraryItemRow[]>` (reject until complete). Constructor creates schema idempotently. Use actual SQLite via Bun test adapter for store tests; fake only the Cloudflare lifecycle interface.

- [ ] Add real SQL tests using the spec's schema: commit one row per type/ID; retain ratings; completion count matches deduplicated rows; empty commit is complete; new store instance reads existing completion. Inject failure during item insertion and during metadata insertion, assert rollback leaves prior data and completion unchanged. Assert an oversized metadata object is rejected before transaction.
- [ ] Add object tests with deferred upstream fetch: two calls with distinct session tokens on one object trigger one entire sequence, and a second object runs independently. Assert no library fetching happens before the object operation and neither token appears in stored rows/metadata/results or persistent object fields.
- [ ] Test concurrent rejection, subsequent retry with a new token, cache-hit no fetch, reconstruction using persisted completion, and readItems rejecting before initialization. Assert no transaction callback returns a Promise and network fetch runs outside the transaction.
- [ ] Run `bun test tests/library-store.test.ts tests/library-cache.test.ts`; confirm new tests fail.
- [ ] Implement parameterized SQL, row validation before transaction, synchronous transactionSync commit, and operation-local token closure. Set the in-flight promise before yielding; clear it safely in finally on success/failure.
- [ ] Run those tests; expect pass. Commit as `feat: persist and coalesce library sync in a Durable Object`.

### Task 5: Service, bindings, runtime verification, and PR

**Files:** `src/library/service.ts`, `src/index.ts`, `wrangler.toml`, `worker-configuration.d.ts`, `README.md`, `tests/library-service.test.ts`, Worker runtime fixture/test configuration under `tests/library-runtime/`.

**Interfaces:** `LibraryService(client: SimklClient, namespace: DurableObjectNamespace<SimklLibraryCache>, getAuth: () => { simklToken: string; simklUserId?: string })` exposes `ensureInitialized(): Promise<LibraryInitialization>` and `readItems(): Promise<LibraryItemRow[]>`. It coalesces legacy identity resolution within the service, retains successful canonical identity, and invokes the object using the current operation token. `readItems` first ensures initialization, then reads rows. Produce exported `SimklLibraryCache` plus `SIMKL_LIBRARY_CACHE` Worker binding and appended v2 SQLite migration.

- [ ] Add failing service tests: verified user 42 maps to `simkl-library:v1:42`; separate sessions for 42 select the same object; user 43 selects another; legacy sessions resolve settings before object selection; failed/malformed lookup never selects an object; a later call retries; service performs no all-items calls itself.
- [ ] Run `bun test tests/library-service.test.ts`; confirm expected failures.
- [ ] Implement the service, export/binding/migration, and README scope/limits. Do not modify watchlist tool/resource routing. Regenerate Worker types with `npx wrangler types` using installed Wrangler.
- [ ] Run a Worker runtime fixture with mock upstream activities/items and two concurrent calls against the actual binding. Verify one fetch sequence, persisted hit after object reconstruction, and actual RPC serializability. Use installed Wrangler/Miniflare tooling; keep fixture routes outside production exports. Save exact command and output in PR validation notes.
- [ ] Run `bun test`, `bun run typecheck`, and `npx wrangler deploy --dry-run`; expect no failures. If tooling is missing, install development tooling in task scratch space and document the reproducible invocation; do not replace meaningful checks with text matching.
- [ ] Inspect final diff against origin/main for secrets, scope creep, transaction async work, identity fallback, limits, and migration preservation. Commit as `feat: expose per-user library cache foundation`.
- [ ] Push `codex/issue-13-library-cache` and open a PR targeting main, titled `Add per-user SQLite library cache initialization`. PR body explains persistent verified identity, object coordination, atomic row storage, bounded split pulls, #14/#15 handoff, exact validation, and `Closes #13`. Do not merge or close the issue manually; GitHub closes it when the PR merges.

## Self-review

All six user additions map to Tasks 1–4. All issue acceptance criteria have fetch/store/object tests. RPC/binding correctness is separately checked in Task 5; mock SQL call counts are insufficient. Task interfaces agree and leave freshness and output changes to their existing issues. Native execution is recommended because five small tasks share identity/client/storage interfaces and this session already holds their context.
