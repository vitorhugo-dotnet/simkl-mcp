export type MediaType = 'shows' | 'movies' | 'anime';

export interface LibraryItemRow {
  mediaType: MediaType;
  simklId: string;
  itemJson: string;
}

export interface LibraryCandidate {
  activities: Record<string, unknown>;
  items: LibraryItemRow[];
}

export interface LibraryInitialization {
  initialized: true;
  itemCount: number;
}

export const MEDIA_TYPES: readonly MediaType[] = ['shows', 'movies', 'anime'];
export const LIBRARY_STATUSES = ['watching', 'plantowatch', 'hold', 'completed', 'dropped'] as const;
export const MAX_ROW_JSON_BYTES = 1024 * 1024;
export const MAX_PENDING_ITEM_BYTES = 32 * 1024 * 1024;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function jsonBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}
