import {
  isRecord, jsonBytes, MAX_ROW_JSON_BYTES, MAX_PENDING_ITEM_BYTES,
  type LibraryCandidate, type LibraryInitialization, type LibraryItemRow,
} from './types.js';

/** Network-free SQLite storage; all serialization happens before transactionSync. */
export class LibraryStore {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS library_items (
      media_type TEXT NOT NULL, simkl_id TEXT NOT NULL, item_json TEXT NOT NULL,
      PRIMARY KEY (media_type, simkl_id))`);
    storage.sql.exec('CREATE TABLE IF NOT EXISTS library_metadata (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)');
    storage.sql.exec("INSERT OR IGNORE INTO library_metadata (key, value_json) VALUES ('schema-version', '1')");
  }

  getInitialization(): LibraryInitialization | null {
    const row = this.storage.sql.exec<{ value_json: string }>(
      "SELECT value_json FROM library_metadata WHERE key = 'completion'",
    ).toArray()[0];
    if (!row) return null;
    const value: unknown = JSON.parse(row.value_json);
    if (!isRecord(value) || !Number.isSafeInteger(value.itemCount) || (value.itemCount as number) < 0) {
      throw new Error('Invalid library cache completion metadata');
    }
    return { initialized: true, itemCount: value.itemCount as number };
  }

  commit(candidate: LibraryCandidate): LibraryInitialization {
    const metadata = JSON.stringify({ activities: candidate.activities, completedAt: Date.now(), itemCount: candidate.items.length });
    if (jsonBytes(metadata) > MAX_ROW_JSON_BYTES) throw new Error('Library metadata too large');
    let pendingBytes = 0;
    for (const item of candidate.items) {
      const bytes = jsonBytes(item.itemJson);
      if (bytes > MAX_ROW_JSON_BYTES) throw new Error('Library item too large');
      pendingBytes += bytes;
      if (pendingBytes > MAX_PENDING_ITEM_BYTES) throw new Error('Library initialization too large');
    }
    this.storage.transactionSync(() => {
      this.storage.sql.exec('DELETE FROM library_items');
      for (const item of candidate.items) {
        this.storage.sql.exec('INSERT INTO library_items (media_type, simkl_id, item_json) VALUES (?, ?, ?)',
          item.mediaType, item.simklId, item.itemJson);
      }
      this.storage.sql.exec("INSERT OR REPLACE INTO library_metadata (key, value_json) VALUES ('completion', ?)", metadata);
    });
    return { initialized: true, itemCount: candidate.items.length };
  }

  readItems(): LibraryItemRow[] {
    return this.storage.sql.exec<{ mediaType: 'shows' | 'movies' | 'anime'; simklId: string; itemJson: string }>(
      'SELECT media_type AS mediaType, simkl_id AS simklId, item_json AS itemJson FROM library_items ORDER BY media_type, simkl_id',
    ).toArray();
  }
}
