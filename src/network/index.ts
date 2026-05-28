import { DictionaryNetworkError, MorphkitDictionary } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CACHE_KEY = 'morphkit_dictionary_cache';
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Minimal interfaces for browser globals
//
// localStorage is DOM-only; fetch is WebWorker/DOM-only.
// Neither appears in lib.esnext.d.ts, which is all the Jest/Node compilation
// context includes. Accessing them via typed globalThis accessors keeps the
// module compilable in both contexts without a platform lib switch.
// ---------------------------------------------------------------------------

interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

interface HttpResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly statusText: string;
  json(): Promise<unknown>;
}

// ---------------------------------------------------------------------------
// Cache entry — the shape we persist in localStorage
// ---------------------------------------------------------------------------

interface CacheEntry {
  /** ISO timestamp of when Morphkit last stored this entry. */
  fetchedAt: string;
  dictionary: MorphkitDictionary;
}

// ---------------------------------------------------------------------------
// Accessors for browser globals
// ---------------------------------------------------------------------------

function getStorage(): StorageAdapter {
  return (globalThis as Record<string, unknown>)['localStorage'] as StorageAdapter;
}

function doFetch(url: string): Promise<HttpResponse> {
  const fn = (globalThis as Record<string, unknown>)['fetch'] as (
    url: string,
  ) => Promise<HttpResponse>;
  return fn(url);
}

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function readCache(): CacheEntry | null {
  try {
    const raw = getStorage().getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
}

function writeCache(dictionary: MorphkitDictionary): void {
  try {
    const entry: CacheEntry = { fetchedAt: new Date().toISOString(), dictionary };
    getStorage().setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage unavailable (quota, private-mode restriction, etc.) — silently skip.
  }
}

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - new Date(entry.fetchedAt).getTime() < CACHE_MAX_AGE_MS;
}

async function fetchAndStore(cdnUrl: string): Promise<MorphkitDictionary> {
  const response = await doFetch(cdnUrl);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const dictionary = (await response.json()) as MorphkitDictionary;
  writeCache(dictionary);
  return dictionary;
}

// ---------------------------------------------------------------------------
// In-flight deduplication for cold-start fetches
//
// If syncDictionary is called concurrently before the first response arrives,
// every caller waits on the same Promise rather than firing duplicate requests.
// The slot is cleared (via .finally) once the fetch settles, so subsequent
// calls after the first completes start a new request normally.
// ---------------------------------------------------------------------------

let pendingColdStart: Promise<MorphkitDictionary> | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * REQ-6.1: Resolves the Morphkit dictionary with a stale-while-revalidate
 * localStorage cache strategy.
 *
 * - **Fresh cache** (< 24 h old): resolves instantly; no network request.
 * - **Stale cache** (≥ 24 h old): resolves instantly from cache; fires a
 *   non-blocking background fetch to refresh localStorage for the next call.
 * - **Cold start** (no cache): awaits the CDN fetch, writes to localStorage,
 *   then resolves.
 * - **Offline + stale cache**: background fetch failure is caught and logged;
 *   the stale dictionary is already returned.
 * - **Offline + no cache**: throws `DictionaryNetworkError`.
 */
export async function syncDictionary(cdnUrl: string): Promise<MorphkitDictionary> {
  const cached = readCache();

  if (cached !== null) {
    if (isFresh(cached)) {
      // REQ-6.2: Fresh — serve immediately, no network.
      return cached.dictionary;
    }

    // REQ-6.3: Stale — return immediately; revalidate in background.
    void fetchAndStore(cdnUrl).catch((err: unknown) => {
      console.warn('[Morphkit] Background dictionary revalidation failed:', err);
    });
    return cached.dictionary;
  }

  // REQ-6.4: Cold start — deduplicate concurrent callers onto one request.
  if (pendingColdStart === null) {
    pendingColdStart = fetchAndStore(cdnUrl).finally(() => {
      pendingColdStart = null;
    });
  }

  try {
    return await pendingColdStart;
  } catch (err: unknown) {
    // REQ-6.5: No cache and network unavailable.
    throw new DictionaryNetworkError(
      `Failed to fetch Morphkit dictionary from "${cdnUrl}": ${(err as Error).message ?? String(err)}`,
      err,
    );
  }
}
