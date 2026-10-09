import { expect, test } from 'bun:test';
import { SimklClient } from '../src/api/client';
import { LibraryService } from '../src/library/service';

function setup() {
  const selected: string[] = []; const upstream: string[] = []; const tokens: string[] = [];
  const client = new SimklClient({ baseUrl: 'https://api.simkl.com', clientId: 'app' });
  client.request = async path => { upstream.push(path); return { account: { id: 42 } } as any; };
  const namespace = { idFromName: (name: string) => name, get: (name: string) => {
    selected.push(name);
    return { ensureInitialized: async (token: string) => { tokens.push(token); return { initialized: true, itemCount: 0 }; }, readItems: async () => [] };
  } } as any;
  return { client, namespace, selected, upstream, tokens };
}

test('same verified account selects same object across sessions; other users are isolated', async () => {
  const s = setup();
  await new LibraryService(s.client, s.namespace, () => ({ simklToken: 'a', simklUserId: '00042' })).ensureInitialized();
  await new LibraryService(s.client, s.namespace, () => ({ simklToken: 'b', simklUserId: '42' })).ensureInitialized();
  await new LibraryService(s.client, s.namespace, () => ({ simklToken: 'c', simklUserId: '43' })).ensureInitialized();
  expect(s.selected).toEqual(['simkl-library:v1:42', 'simkl-library:v1:42', 'simkl-library:v1:43']);
  expect(s.tokens).toEqual(['a', 'b', 'c']);
  expect(s.upstream).toEqual([]);
});

test('legacy lookup is coalesced and retained; service never pulls library', async () => {
  const s = setup(); let token = 'a';
  const service = new LibraryService(s.client, s.namespace, () => ({ simklToken: token }));
  await Promise.all([service.ensureInitialized(), service.ensureInitialized()]);
  token = 'refreshed';
  expect(await service.readItems()).toEqual([]);
  expect(s.upstream).toEqual(['/users/settings']);
  expect(s.tokens).toEqual(['a', 'a', 'refreshed']);
});

test('failed or invalid lookup never selects cache and permits retry', async () => {
  const s = setup();
  const service = new LibraryService(s.client, s.namespace, () => ({ simklToken: 'a', simklUserId: 'simkl_user_uuid' }));
  s.client.request = async () => { throw new Error('failed'); };
  await expect(service.ensureInitialized()).rejects.toThrow('Unable to resolve');
  expect(s.selected).toEqual([]);
  s.client.request = async () => ({ account: { id: 'uuid' } }) as any;
  await expect(service.ensureInitialized()).rejects.toThrow('Unable to resolve');
  expect(s.selected).toEqual([]);
  s.client.request = async () => ({ account: { id: 42 } }) as any;
  await service.ensureInitialized();
  expect(s.selected).toEqual(['simkl-library:v1:42']);
});

test('missing credentials cannot read persisted user data', async () => {
  const s = setup();
  const service = new LibraryService(s.client, s.namespace, () => ({ simklToken: '', simklUserId: '42' }));
  await expect(service.readItems()).rejects.toThrow('Simkl authentication required');
  expect(s.selected).toEqual([]);
});
