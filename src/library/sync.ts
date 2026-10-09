import { SimklApiError, type SimklClient } from '../api/client.js';
import { normalizeSimklId } from './identity.js';
import {
  isRecord, jsonBytes, MEDIA_TYPES, LIBRARY_STATUSES, MAX_ROW_JSON_BYTES, MAX_PENDING_ITEM_BYTES,
  type LibraryCandidate, type LibraryItemRow, type MediaType,
} from './types.js';

export async function fetchInitialLibrary(client: SimklClient, accessToken: string): Promise<LibraryCandidate> {
  const activities = await client.request<unknown>('/sync/activities', { method: 'GET', token: accessToken });
  if (!isRecord(activities) || typeof activities.all !== 'string' || !Number.isFinite(Date.parse(activities.all))) {
    throw new Error('Invalid Simkl activities snapshot');
  }

  const items = new Map<string, LibraryItemRow>();
  let pendingBytes = 0;
  function append(response: unknown, mediaType: MediaType): void {
    if (!isRecord(response) || !Array.isArray(response[mediaType])) {
      throw new Error('Invalid Simkl library response');
    }
    const mediaKey = mediaType === 'shows' ? 'show' : mediaType === 'movies' ? 'movie' : 'anime';
    for (const item of response[mediaType]) {
      const media = isRecord(item) ? item[mediaKey] : undefined;
      const ids = isRecord(media) ? media.ids : undefined;
      const simklId = isRecord(ids) ? normalizeSimklId(ids.simkl) : undefined;
      if (!simklId) throw new Error('Invalid Simkl library item identity');
      const itemJson = JSON.stringify(item);
      const bytes = jsonBytes(itemJson);
      if (bytes > MAX_ROW_JSON_BYTES) throw new Error('Library item too large');
      const key = `${mediaType}:${simklId}`;
      const prior = items.get(key);
      if (prior) {
        if (prior.itemJson !== itemJson) throw new Error('Conflicting Simkl library item');
        continue;
      }
      pendingBytes += bytes;
      if (pendingBytes > MAX_PENDING_ITEM_BYTES) throw new Error('Library initialization too large');
      items.set(key, { mediaType, simklId, itemJson });
    }
  }

  const pull = (path: string) => client.request<unknown>(path, {
    method: 'GET', token: accessToken, responseProfile: 'library',
  });
  for (const mediaType of MEDIA_TYPES) {
    let response: unknown;
    try {
      response = await pull(`/sync/all-items/${mediaType}`);
    } catch (error) {
      if (!(error instanceof SimklApiError) || error.statusCode !== 400 || error.upstreamCode !== 'max_items') throw error;
      for (const status of LIBRARY_STATUSES) {
        append(await pull(`/sync/all-items/${mediaType}/${status}`), mediaType);
      }
      continue;
    }
    append(response, mediaType);
  }
  return { activities, items: [...items.values()] };
}
