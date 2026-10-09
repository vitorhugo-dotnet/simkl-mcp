import { Database } from 'bun:sqlite';

export function sqliteStorage() {
  const db = new Database(':memory:');
  let inTransaction = false;
  let transactions = 0;
  const storage = {
    sql: {
      exec(query: string, ...bindings: unknown[]) {
        const rows = db.query(query).all(...bindings as any[]);
        return { toArray: () => rows, [Symbol.iterator]: () => rows[Symbol.iterator]() };
      },
    },
    transactionSync<T>(callback: () => T): T {
      transactions++;
      return db.transaction(() => {
        inTransaction = true;
        try {
          const result = callback();
          if (result instanceof Promise) throw new Error('Async storage transaction');
          return result;
        } finally { inTransaction = false; }
      })();
    },
  } as unknown as DurableObjectStorage;
  return { db, storage, isInTransaction: () => inTransaction, transactions: () => transactions };
}
