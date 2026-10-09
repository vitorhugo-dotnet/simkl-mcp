import { expect, test } from 'bun:test';
import { LibraryStore } from '../src/library/store';
import { sqliteStorage } from './helpers/library-storage';
import type { LibraryCandidate } from '../src/library/types';

const candidate = (id = '42'): LibraryCandidate => ({ activities: { all: '2026-10-09T12:00:00Z' }, items: [
  { mediaType: 'shows', simklId: id, itemJson: JSON.stringify({ show: { ids: { simkl: Number(id) } }, user_rating: 8 }) },
  { mediaType: 'movies', simklId: id, itemJson: JSON.stringify({ movie: { ids: { simkl: Number(id) } }, user_rating: null }) },
] });

test('stores separate media/ID rows, retains ratings and survives store reconstruction', () => {
  const { storage, db } = sqliteStorage();
  const store = new LibraryStore(storage);
  expect(store.getInitialization()).toBeNull();
  expect(store.commit(candidate())).toEqual({ initialized: true, itemCount: 2 });
  const reconstructed = new LibraryStore(storage);
  expect(reconstructed.getInitialization()).toEqual({ initialized: true, itemCount: 2 });
  expect(reconstructed.readItems()).toHaveLength(2);
  expect(reconstructed.readItems().map(r => JSON.parse(r.itemJson).user_rating).sort()).toEqual([8, null].sort());
  expect((db.query("SELECT value_json FROM library_metadata WHERE key='completion'").get() as any).value_json).toContain('2026-10-09T12:00:00Z');
  db.close();
});

test('empty library has a durable completion record', () => {
  const { storage, db } = sqliteStorage();
  const store = new LibraryStore(storage);
  store.commit({ ...candidate(), items: [] });
  expect(new LibraryStore(storage).getInitialization()).toEqual({ initialized: true, itemCount: 0 });
  db.close();
});

test.each(['item', 'metadata'])('actual SQLite rollback preserves prior rows and snapshot on %s failure', kind => {
  const { storage, db } = sqliteStorage();
  const store = new LibraryStore(storage);
  store.commit(candidate());
  const priorItems = store.readItems();
  const priorMeta = db.query('SELECT * FROM library_metadata ORDER BY key').all();
  if (kind === 'item') db.exec("CREATE TRIGGER fail BEFORE INSERT ON library_items WHEN NEW.media_type='shows' BEGIN SELECT RAISE(ABORT, 'injected'); END");
  else db.exec("CREATE TRIGGER fail BEFORE INSERT ON library_metadata WHEN NEW.key='completion' BEGIN SELECT RAISE(ABORT, 'injected'); END");
  expect(() => store.commit(candidate('43'))).toThrow('injected');
  expect(store.readItems()).toEqual(priorItems);
  expect(db.query('SELECT * FROM library_metadata ORDER BY key').all()).toEqual(priorMeta);
  db.close();
});

test('failed first transaction never creates completion', () => {
  const { storage, db } = sqliteStorage();
  const store = new LibraryStore(storage);
  db.exec("CREATE TRIGGER fail BEFORE INSERT ON library_metadata WHEN NEW.key='completion' BEGIN SELECT RAISE(ABORT, 'injected'); END");
  expect(() => store.commit(candidate())).toThrow('injected');
  expect(store.getInitialization()).toBeNull();
  expect(store.readItems()).toEqual([]);
  db.close();
});

test('oversized item/metadata reject before transaction, preserving prior data', () => {
  const adapter = sqliteStorage();
  const store = new LibraryStore(adapter.storage);
  store.commit(candidate());
  const count = adapter.transactions();
  for (const oversized of [
    { ...candidate(), activities: { all: '2026-10-09T12:00:00Z', extra: 'x'.repeat(1024 * 1024) } },
    { ...candidate(), items: [{ ...candidate().items[0], itemJson: 'x'.repeat(1024 * 1024 + 1) }] },
  ]) {
    expect(() => store.commit(oversized)).toThrow('too large');
  }
  expect(adapter.transactions()).toBe(count);
  expect(store.readItems()).toEqual(candidate().items.sort((a,b) => a.mediaType.localeCompare(b.mediaType)));
  adapter.db.close();
});
