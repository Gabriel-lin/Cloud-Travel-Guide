/** IndexedDB 简单 KV 缓存(地理数据 7 天有效)。 */

const DB_NAME = "region-engine-cache";
const STORE = "kv";
const TTL_MS = 7 * 24 * 3600 * 1000;

type Entry = { at: number; data: unknown };

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => {
      const entry = req.result as Entry | undefined;
      if (!entry || Date.now() - entry.at > TTL_MS) {
        resolve(null);
      } else {
        resolve(entry.data as T);
      }
      db.close();
    };
    req.onerror = () => {
      resolve(null);
      db.close();
    };
  });
}

export async function cacheSet(key: string, data: unknown): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ at: Date.now(), data } satisfies Entry, key);
    tx.oncomplete = () => {
      resolve();
      db.close();
    };
    tx.onerror = () => {
      resolve();
      db.close();
    };
  });
}
