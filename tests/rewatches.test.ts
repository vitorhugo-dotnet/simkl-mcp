import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SimklClient } from '../src/api/client';
import { RewatchPlanError, RewatchService } from '../src/api/rewatches';

describe('RewatchService', () => {
  let originalFetch: typeof fetch;
  let requests: Array<{ url: URL; init: RequestInit }>;
  let accountType: string | undefined;
  let stopStatus = 'active';
  let token = 'token-a';
  let now = 0;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    requests = [];
    accountType = 'pro';
    stopStatus = 'active';
    token = 'token-a';
    now = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push({ url, init: init ?? {} });
      if (url.pathname === '/users/settings') {
        return Response.json({ account: { type: accountType } });
      }
      if (url.pathname === '/sync/history') {
        return Response.json({ added: { statuses: [{ response: { rewatch_id: 42, rewatch_status: 'active' } }] } });
      }
      if (url.pathname.startsWith('/sync/all-items')) return Response.json({ shows: [{ is_rewatch: true, rewatch_id: 42 }] });
      if (url.pathname === '/scrobble/stop') return Response.json({ action: 'scrobble', progress: 95, rewatch_id: 42, rewatch_status: stopStatus });
      return Response.json({});
    }) as typeof fetch;
  });

  afterEach(() => { globalThis.fetch = originalFetch; });

  const createService = () => new RewatchService(
    new SimklClient({ baseUrl: 'https://api.simkl.com', clientId: 'app-id' }),
    () => token,
    () => now,
  );

  test('starts a movie rewatch with explicit opt-in and returns the upstream session response', async () => {
    const service = createService();
    const response = await service.start({ mediaType: 'movies', ids: { simkl: 123 }, watched_at: '2026-01-01T00:00:00Z' });
    const write = requests.find(request => request.url.pathname === '/sync/history')!;
    expect(write.url.searchParams.get('allow_rewatch')).toBe('yes');
    expect(JSON.parse(String(write.init.body))).toEqual({ movies: [{ ids: { simkl: 123 }, watched_at: '2026-01-01T00:00:00Z', is_rewatch: true }] });
    expect(response).toHaveProperty('added.statuses.0.response.rewatch_id', 42);
  });

  test('serializes anime history in the anime collection', async () => {
    const service = createService();
    await service.start({ mediaType: 'anime', ids: { mal: 4246 }, seasons: [{ number: 1 }] });
    const body = JSON.parse(String(requests.find(request => request.url.pathname === '/sync/history')!.init.body));
    expect(body.anime[0]).toEqual({ ids: { mal: 4246 }, seasons: [{ number: 1 }], is_rewatch: true });
  });

  test('pins the session ID for updates and refuses completed shows', async () => {
    const service = createService();
    await expect(service.update({ mediaType: 'shows', ids: { simkl: 5 }, rewatch_id: 42, rewatch_status: 'active', watched_at: '2026-01-02T00:00:00Z', seasons: [{ number: 1, episodes: [{ number: 2, watched_at: '2026-01-02T00:00:00Z' }] }] })).resolves.toBeDefined();
    const write = requests.find(request => request.url.pathname === '/sync/history')!;
    expect(JSON.parse(String(write.init.body)).shows[0]).toEqual({
      ids: { simkl: 5 }, rewatch_id: 42, rewatch_status: 'active', watched_at: '2026-01-02T00:00:00Z',
      seasons: [{ number: 1, episodes: [{ number: 2, watched_at: '2026-01-02T00:00:00Z' }] }],
    });
    await expect(service.update({ mediaType: 'shows', ids: { simkl: 5 }, rewatch_id: 42, rewatch_status: 'completed' })).rejects.toThrow(/can only be set for movies/);
    expect(requests.filter(request => request.url.pathname === '/sync/history')).toHaveLength(1);
  });

  test('supports explicit movie session close and completion transitions', async () => {
    const service = createService();
    for (const rewatch_status of ['closed', 'completed'] as const) {
      await service.update({ mediaType: 'movies', ids: { simkl: 5 }, rewatch_id: 42, rewatch_status });
    }
    const writes = requests.filter(request => request.url.pathname === '/sync/history');
    expect(writes.map(request => JSON.parse(String(request.init.body)).movies[0])).toEqual([
      { ids: { simkl: 5 }, rewatch_id: 42, rewatch_status: 'closed' },
      { ids: { simkl: 5 }, rewatch_id: 42, rewatch_status: 'completed' },
    ]);
  });

  test('can resume a pinned session at start and carries an optional lifecycle status', async () => {
    const service = createService();
    await service.start({ mediaType: 'shows', ids: { simkl: 9 }, rewatch_id: 42, rewatch_status: 'active' });
    const body = JSON.parse(String(requests.find(request => request.url.pathname === '/sync/history')!.init.body));
    expect(body.shows[0]).toEqual({ ids: { simkl: 9 }, is_rewatch: true, rewatch_id: 42, rewatch_status: 'active' });
  });

  test('requires date_from except during an explicit initial sync and preserves rewatch rows', async () => {
    const service = createService();
    await expect(service.list({ mediaType: 'all', status: 'completed' })).rejects.toThrow(/date_from/);
    const result = await service.list({ mediaType: 'all', status: 'completed', initial_sync: true });
    const read = requests.find(request => request.url.pathname.includes('/sync/all-items'))!;
    expect(read.url.pathname).toBe('/sync/all-items/all/completed');
    expect(read.url.searchParams.get('allow_rewatch')).toBe('yes');
    expect(read.url.searchParams.get('extended')).toBe('full');
    expect(read.url.searchParams.get('episode_watched_at')).toBe('yes');
    expect(result.shows[0].rewatch_id).toBe(42);
    await service.list({ mediaType: 'anime', status: 'watching', date_from: '2026-01-01T00:00:00Z' });
    const incremental = requests.filter(request => request.url.pathname.includes('/sync/all-items'))[1];
    expect(incremental.url.pathname).toBe('/sync/all-items/anime/watching');
    expect(incremental.url.searchParams.get('date_from')).toBe('2026-01-01T00:00:00Z');
  });

  test('gates rewatch writes on the plan and caches eligibility for five minutes per token', async () => {
    const service = createService();
    accountType = 'free';
    await expect(service.start({ mediaType: 'movies', ids: { simkl: 1 } })).rejects.toBeInstanceOf(RewatchPlanError);
    expect(requests.filter(request => request.url.pathname === '/sync/history')).toHaveLength(0);
    accountType = 'vip';
    now = 5 * 60 * 1000 + 1;
    await service.start({ mediaType: 'movies', ids: { simkl: 1 } });
    token = 'token-b';
    accountType = 'free';
    await expect(service.start({ mediaType: 'movies', ids: { simkl: 2 } })).rejects.toBeInstanceOf(RewatchPlanError);
    expect(requests.filter(request => request.url.pathname === '/users/settings')).toHaveLength(3);
  });

  test('fails closed for missing credentials, unknown plan type and settings errors', async () => {
    const service = createService();
    token = undefined as unknown as string;
    await expect(service.start({ mediaType: 'movies', ids: { simkl: 1 } })).rejects.toBeInstanceOf(RewatchPlanError);
    expect(requests).toHaveLength(0);

    token = 'token-a';
    accountType = undefined;
    await expect(service.start({ mediaType: 'movies', ids: { simkl: 1 } })).rejects.toBeInstanceOf(RewatchPlanError);
    expect(requests.filter(request => request.url.pathname === '/sync/history')).toHaveLength(0);

    const failingService = createService();
    globalThis.fetch = (async () => { throw new Error('settings unavailable'); }) as typeof fetch;
    await expect(failingService.start({ mediaType: 'movies', ids: { simkl: 1 } })).rejects.toThrow('simkl api request failed');
    expect(requests.filter(request => request.url.pathname === '/sync/history')).toHaveLength(0);
  });

  test('does not request plan eligibility for a normal stop and only opts in on explicit qualifying stops', async () => {
    const service = createService();
    await service.stop({ body: { progress: 95, movie: { ids: { simkl: 4 } } }, allow_rewatch: false });
    const plainStop = requests.find(request => request.url.pathname === '/scrobble/stop')!;
    expect(plainStop.url.searchParams.has('allow_rewatch')).toBe(false);
    await expect(service.stop({ body: { progress: 79 }, allow_rewatch: true })).rejects.toThrow(/80/);
    await service.stop({ body: { progress: 80, movie: { ids: { simkl: 4 } } }, allow_rewatch: true });
    const optedStop = requests.filter(request => request.url.pathname === '/scrobble/stop')[1];
    expect(optedStop.url.searchParams.get('allow_rewatch')).toBe('yes');
    expect(requests.filter(request => request.url.pathname === '/users/settings')).toHaveLength(1);
  });

  test('preserves non-success statuses and invalidates eligibility after pro_required', async () => {
    const service = createService();
    stopStatus = 'too_soon';
    const tooSoon = await service.stop({ body: { progress: 95 }, allow_rewatch: true });
    expect(tooSoon.rewatch_status).toBe('too_soon');
    expect(tooSoon.rewatch_id).toBe(42);
    stopStatus = 'pro_required';
    await service.stop({ body: { progress: 95 }, allow_rewatch: true });
    accountType = 'free';
    await expect(service.stop({ body: { progress: 95 }, allow_rewatch: true })).rejects.toBeInstanceOf(RewatchPlanError);
    expect(requests.filter(request => request.url.pathname === '/users/settings')).toHaveLength(2);
  });

  test('does not retry a history write after an ambiguous network failure', async () => {
    const service = createService();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push({ url, init: {} });
      if (url.pathname === '/users/settings') return Response.json({ account: { type: 'pro' } });
      throw new Error('connection dropped after send');
    }) as typeof fetch;
    await expect(service.start({ mediaType: 'movies', ids: { simkl: 12 } })).rejects.toThrow('simkl api request failed');
    expect(requests.filter(request => request.url.pathname === '/sync/history')).toHaveLength(1);
  });
});
