// The device's queue of meals not uploaded yet (docs/DESIGN.md section 3). Send writes the meal
// here first, then the uploader sends it; a meal taken offline waits here until the app is open
// and online again (or the service worker's Background Sync sends it, see public/sw.js, which
// reads the same database). Photos are stored as ArrayBuffers (older Safari versions cannot keep
// Blobs in IndexedDB). When IndexedDB is not available (some private windows), the queue lives
// in memory for as long as the page is open.
//
// Browser only. Keep DB_NAME, STORE and the record shape in step with public/sw.js.

export const DB_NAME = "cal-capture";
export const DB_VERSION = 1;
export const STORE = "meals";

export type QueuedPhoto = { type: string; data: ArrayBuffer; width: number; height: number };

export type QueuedMeal = {
  /** The id the server uses to recognise a repeated upload of the same meal. */
  clientId: string;
  /** Only this account uploads it (a shared device may switch accounts). */
  userId: string;
  createdAt: number;
  /** ISO time of the first photo. */
  eatenAt: string;
  tz: string;
  note: string;
  photos: QueuedPhoto[];
  /** waiting: will be sent; failed: the server refused it, the person decides. */
  state: "waiting" | "failed";
  attempts: number;
  error: string | null;
  /** Do not try again before this time (ms), after a busy or failing server. */
  nextAttemptAt: number;
};

const memory = new Map<string, QueuedMeal>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

const promisify = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const open = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE, { keyPath: "clientId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
};

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> => {
  const db = await open();
  if (!db) return undefined;
  const tx = db.transaction(STORE, mode);
  const result = await promisify(run(tx.objectStore(STORE)));
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return result;
};

/** Whether meals survive closing the page (IndexedDB works here). */
export const queueIsPersistent = async () => (await open()) !== null;

/** All queued meals of one account, oldest first. */
export const listQueued = async (userId: string): Promise<QueuedMeal[]> => {
  let all: QueuedMeal[];
  try {
    all = (await withStore("readonly", (s) => s.getAll() as IDBRequest<QueuedMeal[]>)) ?? [
      ...memory.values(),
    ];
  } catch {
    all = [...memory.values()];
  }
  return all.filter((m) => m.userId === userId).sort((a, b) => a.createdAt - b.createdAt);
};

export const putQueued = async (meal: QueuedMeal) => {
  try {
    const stored = await withStore("readwrite", (s) => s.put(meal));
    if (stored !== undefined) return;
  } catch {
    // Storage full or refused: keep it for this page at least.
  }
  memory.set(meal.clientId, meal);
};

export const removeQueued = async (clientId: string) => {
  memory.delete(clientId);
  try {
    await withStore("readwrite", (s) => s.delete(clientId));
  } catch {
    // Already gone.
  }
};

export const getQueued = async (clientId: string) => {
  try {
    const found = await withStore("readonly", (s) => s.get(clientId) as IDBRequest<QueuedMeal>);
    return found ?? memory.get(clientId) ?? null;
  } catch {
    return memory.get(clientId) ?? null;
  }
};

/** A random id for a new meal (also accepted by the upload route: 8 to 64 of [A-Za-z0-9_-]). */
export const newClientId = () =>
  typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join("");

export const photoBlob = (photo: QueuedPhoto) => new Blob([photo.data], { type: photo.type });
