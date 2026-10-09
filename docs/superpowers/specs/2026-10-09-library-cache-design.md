# Per-user Simkl library cache

Issue: https://github.com/vitorhugo-dotnet/simkl-mcp/issues/13

Status: design approved in chat on 2026-10-09, including the six requested storage, identity, coordination, error, and response-limit requirements. Final review corrected three inferred API details against the checked-in Simkl OpenAPI: anime uses a `show` block, empty filtered responses are `{}`, and movie status fallback has three supported buckets.

## Goal and scope

Provide persistent, isolated library initialization for authenticated Simkl accounts across MCP sessions. A separate SQLite-backed Durable Object owns initialization and serves stored canonical library records. Issue #14 owns subsequent activity checks and incremental synchronization; #15 owns routing watchlist tools/resources through the cache and changing their output. This PR provides the callable foundation for those issues without claiming existing watchlist reads are cached yet. Settings/statistics caching (#17) and write serialization (#16) are excluded.

## Verified identity

Add optional `simklUserId: string` to shared OAuth props. Store the raw verified `account.id` from `/users/settings`, normalized to a positive decimal string (numeric input must be a positive safe integer). Preserve it through token refresh. The provider's existing `simkl_user_<id>` user identifier is separate from this value; the random fallback used when settings lookup fails is never accepted as a library identity.

For a legacy session or a login whose settings lookup failed, resolve `/users/settings` using the authenticated access token before addressing the cache. Coalesce lookup within that MCP session, retain successful resolution in its props/memory, and retry on subsequent access after failure. Do not claim this mutates an already-issued provider grant: new authorizations persist the value in provider OAuth props; existing grants can resolve again in a later session. Reject invalid or missing IDs and upstream lookup failures before accessing any cache object. Never infer identity from session IDs, token text, or random UUIDs.

Use `SIMKL_LIBRARY_CACHE.idFromName('simkl-library:v1:' + simklUserId)`. This namespace is internal to the Worker, with no public HTTP cache endpoint and no model-selected user ID.

## Components and operation

`SimklLibraryCache` extends Cloudflare `DurableObject` and owns storage plus one in-flight initialization promise. Its RPC method `ensureInitialized(accessToken: string): Promise<LibraryInitialization>` receives an access token only for that operation. The object creates a Simkl client from Worker configuration; it performs every initialization API request itself. MCP sessions must not fetch library items before invoking it.

On a complete stored snapshot, return `{ initialized: true, itemCount }` without upstream calls. Otherwise create the shared promise synchronously before yielding; every concurrent caller awaits the same initialization attempt. Clear it on success or rejection so retries can proceed. Tokens are not written to SQLite, KV, logs, returned results, or object fields; only the active operation closure holds its token. Failure with one caller's token fails that shared attempt; a later invocation may retry with a valid token.

A library service resolves verified identity and addresses the object. Provide session-local initialization and item-read methods for later consumers, but do not wire existing watchlist handlers in #13. Item reads require successful initialization. Object reconstruction checks persisted completion metadata instead of relying on the lost promise.

## Initial sync

1. GET `/sync/activities` and validate an object with a nonempty top-level `all` timestamp. Hold this candidate snapshot without writing it.
2. GET `/sync/all-items/shows`, `/sync/all-items/movies`, then `/sync/all-items/anime`, strictly sequentially. Never send `extended`, `date_from`, or ratings requests.
3. Accept the documented empty response `{}`; otherwise require the requested media array. Validate object items, their corresponding identity (`movie` for movies, `show` for both shows and anime), and positive Simkl IDs; reject malformed results instead of marking an incomplete cache ready. Empty arrays are valid.
4. Preserve full item JSON, including user ratings and unknown optional fields. Key rows by media type and normalized Simkl ID. Identical duplicate rows may be collapsed; conflicting duplicate rows abort initialization rather than choose an arbitrary snapshot.
5. Once all pulls, merging, serialization, and size validation succeed, persist items and the candidate snapshot atomically.

The activities snapshot predates item pulls intentionally: later incremental sync can revisit changes that occurred during initialization instead of skipping them.

## Split pulls and errors

Extend the sanitized `SimklApiError.upstreamCode` allowlist with `max_items`. Only HTTP 400 with that exact upstream error triggers fallback. For the failed media type, sequentially GET `/sync/all-items/<type>/<status>` in this order: `watching`, `plantowatch`, `hold`, `completed`, `dropped` for shows/anime; movies use only `plantowatch`, `completed`, `dropped`. Combine all responses and validate before commit. Continue subsequent media types only after this fallback succeeds. A split failure, including another `max_items`, aborts; there is no recursive split, unlimited retry, or silent truncation. Other HTTP 400 errors, quota errors, body-read failures, and invalid JSON propagate as sanitized failures and never advance completion metadata.

## Storage and atomicity

SQLite schema:

- `library_items(media_type TEXT, simkl_id TEXT, item_json TEXT, PRIMARY KEY(media_type, simkl_id))`.
- `library_metadata(key TEXT PRIMARY KEY, value_json TEXT)` for schema version and one small completion record containing candidate activities, completion time, and item count.

Store one item per row, never one library blob. Enforce a conservative 1 MiB UTF-8 serialized item/metadata limit, leaving room below Cloudflare's 2 MB row limit for row keys and SQLite overhead. Enforce the same checks before the transaction. A malformed or oversized item rejects the complete attempt.

All network calls, validation, deduplication, and JSON serialization occur outside the storage transaction. Use a short synchronous `ctx.storage.transactionSync(() => { ... })` to replace item rows and write completion metadata last. No async callback or `await` inside it. Throwing at any insert or metadata write rolls back the entire transaction. No success result may be returned before commit. An empty library still records successful completion. Failed attempts preserve any prior committed rows and metadata; a new object with no completion remains uninitialized. Schema creation is idempotent and separate from initialization.

## Bounded larger responses

Keep the default response limit at `2 * 1024 * 1024` bytes. Allow a library-specific response profile only for relative GET paths `/sync/all-items/<shows|movies|anime>` and their five status variants. That profile raises successful body reads to `16 * 1024 * 1024` bytes; it cannot apply to activities, settings, ratings, arbitrary absolute URLs, unrelated methods, or unrelated endpoints. Error responses retain the default limit.

Count actual bytes while reading the stream, reject and cancel immediately when exceeding the selected cap, and check before decoding/appending the chunk. Do not trust Content-Length. A no-stream fallback checks UTF-8 byte length, not JavaScript character count. Exactly-at-limit bodies pass. Bound total serialized pending item data across all pulls at `32 * 1024 * 1024` bytes, including split responses, before beginning the transaction. These are implementation guardrails, not Simkl API limits; exceeding them yields an explicit sanitized size error and no completed cache. Never silently truncate or remove fields to fit.

## Runtime integration

Export the new object from `src/index.ts`. Append migration tag `v2` with `new_sqlite_classes = ['SimklLibraryCache']`, preserving the existing `v1` migration and MCP binding. Add `SIMKL_LIBRARY_CACHE` binding and regenerate Worker types using Wrangler. Document scope, sizes, and the #14/#15 handoff. No production deployment or unrelated dependency upgrade is required.

## Verification

Use Bun for identity, fetch orchestration, byte limits, error classification, and SQL-store tests. A SQLite-backed test adapter must support actual transactions/rollback; do not rely solely on mock insert call counts. Cover verified OAuth props, refresh preservation, legacy resolution and retries; separate users and same-user sessions; delayed concurrent first reads sharing one upstream sequence; no token in stored data; sequential requests/no extended; rating retention; empty arrays; reconstruction after completion; API and storage failures leaving no new completion; split success/failure; malformed/conflicting identities; per-row and aggregate limits; >2 MiB successful library reads; default caps elsewhere; multibyte/chunked bodies and cancellation.

Run the full existing suite, typecheck, and Wrangler dry-run with regenerated bindings. A Worker-runtime test or local RPC smoke check must verify that the exported object and binding work together; a Bun-only fake cannot establish Cloudflare RPC compatibility. No live user library or OAuth credentials are needed for fixture tests.

## References

- https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/ — synchronous transactions and rollback.
- https://developers.cloudflare.com/durable-objects/platform/limits/ — SQLite row and object limits.
- Existing `src/auth-handler.ts`, `src/auth/simkl-oauth.ts`, `src/api/client.ts`, `src/mcp-agent.ts`, and `wrangler.toml` on main at `6dfba48`.
