import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { SimklClient } from '../src/api/client';
import { APP_NAME, APP_VERSION, USER_AGENT } from '../src/app-info';
import { getTrendingByGenre } from '../src/api/trending';

describe('Simkl AUTH V2 API request identification', () => {
  let originalFetch: typeof fetch;
  let request: { url: URL; init: RequestInit } | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    request = undefined;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      request = { url: new URL(String(input)), init: init ?? {} };
      return Response.json({});
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('includes required app identification and User-Agent on authenticated API calls', async () => {
    const client = new SimklClient({ baseUrl: 'https://api.simkl.com', clientId: 'auth-v2-client' });
    await client.request('/users/settings', { method: 'GET', token: 'access-token' });

    expect(request?.url.searchParams.get('client_id')).toBe('auth-v2-client');
    expect(request?.url.searchParams.get('app-name')).toBe(APP_NAME);
    expect(request?.url.searchParams.get('app-version')).toBe(APP_VERSION);
    expect(new Headers(request?.init.headers).get('User-Agent')).toBe(USER_AGENT);
    expect(new Headers(request?.init.headers).get('Authorization')).toBe('Bearer access-token');
  });

  test('sends identification but no Bearer header to both public genre CDN files', async () => {
    const requests: Array<{ url: URL; headers: Headers }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (url.pathname.endsWith('/index.json')) {
        return Response.json([{ name: 'Drama', slug: 'drama', count: 1 }]);
      }
      return Response.json([{ title: 'Drama item', overview: 'full item shape' }], {
        headers: { 'Last-Modified': 'Thu, 08 Oct 2026 00:00:00 GMT' },
      });
    }) as typeof fetch;

    const client = new SimklClient({ baseUrl: 'https://api.simkl.com', clientId: 'auth-v2-client' });
    await getTrendingByGenre(client, 'anime', 'drama');

    expect(requests).toHaveLength(2);
    for (const request of requests) {
      expect(request.url.origin).toBe('https://data.simkl.in');
      expect(request.url.searchParams.get('client_id')).toBe('auth-v2-client');
      expect(request.url.searchParams.get('app-name')).toBe(APP_NAME);
      expect(request.url.searchParams.get('app-version')).toBe(APP_VERSION);
      expect(request.headers.get('User-Agent')).toBe(USER_AGENT);
      expect(request.headers.has('Authorization')).toBe(false);
    }
  });
});
