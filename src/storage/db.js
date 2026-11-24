/**
 * InstaHarvest — tiny promise-based IndexedDB wrapper.
 * Used by the service worker (persistence, resume) and the panel (export).
 * No third-party dependency.
 */
import { DEFAULT_SETTINGS, mergeSettings } from './schema.js';

export const DB_NAME = 'instaharvest';
export const DB_VERSION = 1;

export const STORES = {
  meta: { keyPath: 'key', indexes: [] },
  profiles: { keyPath: 'profileUsername', indexes: [] },
  followers: {
    keyPath: 'profileUsername',
    indexes: [{ name: 'byProfile', keyPath: 'profileUsername' }]
  },
  following: {
    keyPath: 'profileUsername',
    indexes: [{ name: 'byProfile', keyPath: 'profileUsername' }]
  },
  posts: {
    keyPath: ['profileUsername', 'shortcode'],
    indexes: [
      { name: 'byProfile', keyPath: 'profileUsername' },
      { name: 'byShortcode', keyPath: 'shortcode' }
    ]
  },
  comments: {
    keyPath: ['profileUsername', 'shortcode'],
    indexes: [{ name: 'byProfile', keyPath: 'profileUsername' }]
  },
  likers: {
    keyPath: ['profileUsername', 'shortcode'],
    indexes: [{ name: 'byProfile', keyPath: 'profileUsername' }]
  },
  jobs: {
    keyPath: 'id',
    indexes: [{ name: 'byProfile', keyPath: 'profileUsername' }]
  }
};

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const [name, cfg] of Object.entries(STORES)) {
        if (db.objectStoreNames.contains(name)) continue;
        const store = db.createObjectStore(name, { keyPath: cfg.keyPath });
        for (const idx of cfg.indexes) {
          store.createIndex(idx.name, idx.keyPath, { unique: !!idx.unique });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('IndexedDB upgrade blocked by another tab'));
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    let tx;
    try {
      tx = db.transaction(storeName, mode);
    } catch (err) {
      reject(err);
      return;
    }
    const store = tx.objectStore(storeName);
    let request;
    try {
      request = fn(store);
    } catch (err) {
      reject(err);
      return;
    }
    let result;
    if (request) {
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => reject(request.error);
    }
    tx.oncomplete = () => resolve(result ?? null);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export function get(store, key) {
  return withStore(store, 'readonly', (s) => s.get(key));
}

export function put(store, value) {
  return withStore(store, 'readwrite', (s) => s.put(value));
}

export function del(store, key) {
  return withStore(store, 'readwrite', (s) => s.delete(key));
}

export function getAll(store) {
  return withStore(store, 'readonly', (s) => s.getAll());
}

export function getAllBy(store, indexName, value) {
  return withStore(store, 'readonly', (s) => s.index(indexName).getAll(value));
}

export function clearStore(store) {
  return withStore(store, 'readwrite', (s) => s.clear());
}

export function count(store) {
  return withStore(store, 'readonly', (s) => s.count());
}

// ---- meta / settings / daily counters ----

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row && 'value' in row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value, updatedAt: new Date().toISOString() });
}

export async function getSettings() {
  return mergeSettings(await getMeta('settings', {}));
}

export async function saveSettings(settings) {
  const merged = mergeSettings(settings);
  await setMeta('settings', merged);
  return merged;
}

export async function getDaily(dateKey) {
  const daily = await getMeta('daily', null);
  const fallback = { date: dateKey, profiles: 0, minutes: 0, updatedAt: new Date().toISOString() };
  if (!daily || daily.date !== dateKey) return fallback;
  return { ...fallback, ...daily };
}

export async function saveDaily(daily) {
  await setMeta('daily', { ...daily, updatedAt: new Date().toISOString() });
  return daily;
}

export async function getLatestJob() {
  const jobs = await getAll('jobs');
  if (!jobs.length) return null;
  jobs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return jobs[0];
}

export async function getActiveJob() {
  const jobs = await getAll('jobs');
  const active = jobs
    .filter((j) => ['running', 'waiting', 'paused'].includes(j.state))
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return active[0] || null;
}

export async function getProfiles() {
  const profiles = await getAll('profiles');
  return profiles.sort((a, b) => (b.scrapedAt || '').localeCompare(a.scrapedAt || ''));
}

export { DEFAULT_SETTINGS };
