import type { SimklClient } from '../api/client.js';

/** Accept account/item IDs, never provider IDs or MCP session identifiers. */
export function normalizeSimklId(value: unknown): string | undefined {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : undefined;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined;
  const canonical = value.replace(/^0+/, '');
  return canonical || undefined;
}

export async function resolveSimklUserId(
  client: SimklClient, token: string, knownId?: string,
): Promise<string> {
  const known = normalizeSimklId(knownId);
  if (known) return known;
  try {
    const settings = await client.request<{ account?: { id?: unknown } }>('/users/settings', {
      method: 'GET', token,
    });
    const id = normalizeSimklId(settings?.account?.id);
    if (id) return id;
  } catch {
    // Settings/protocol errors may contain credential-bearing upstream data.
  }
  throw new Error('Unable to resolve Simkl account identity');
}
