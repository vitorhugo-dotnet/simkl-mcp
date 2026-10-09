import { describe, expect, test } from 'bun:test';
import { SimklClient } from '../src/api/client';
import { normalizeSimklId, resolveSimklUserId } from '../src/library/identity';

describe('verified Simkl identity', () => {
  test('normalizes positive account identifiers without accepting session IDs', () => {
    expect(normalizeSimklId(42)).toBe('42');
    expect(normalizeSimklId('00042')).toBe('42');
    expect(normalizeSimklId('9007199254740993')).toBe('9007199254740993');
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', '0', 'simkl_user_42', 'uuid', {}, null]) {
      expect(normalizeSimklId(value)).toBeUndefined();
    }
  });
  test('reuses only canonical verified ID and resolves legacy identity with the token', async () => {
    const client = new SimklClient({ baseUrl: 'https://api.simkl.com', clientId: 'app' });
    const calls: unknown[] = [];
    client.request = async (path, options) => {
      calls.push({ path, options });
      return { account: { id: 42 } } as any;
    };
    expect(await resolveSimklUserId(client, 'token', '00042')).toBe('42');
    expect(calls).toHaveLength(0);
    expect(await resolveSimklUserId(client, 'token', 'simkl_user_uuid')).toBe('42');
    expect(calls).toEqual([{ path: '/users/settings', options: { method: 'GET', token: 'token' } }]);
  });
  test('failed lookup has sanitized error and permits a later retry', async () => {
    const client = new SimklClient({ baseUrl: 'https://api.simkl.com', clientId: 'app' });
    client.request = async () => { throw new Error('secret-token'); };
    await expect(resolveSimklUserId(client, 'token')).rejects.toThrow('Unable to resolve Simkl account identity');
    client.request = async () => ({ account: { id: '42' } }) as any;
    expect(await resolveSimklUserId(client, 'token')).toBe('42');
    client.request = async () => ({ account: { id: 'uuid' } }) as any;
    await expect(resolveSimklUserId(client, 'token')).rejects.toThrow('Unable to resolve Simkl account identity');
  });
});
