import { DictionaryNetworkError, MorphkitDictionary } from '../src/types';
import { syncDictionary } from '../src/network';
import { mockDictionary } from './__mocks__/mockDictionary';

// ---------------------------------------------------------------------------
// In-memory localStorage mock
// ---------------------------------------------------------------------------

class LocalStorageMock {
  private store: Record<string, string> = {};

  getItem(key: string): string | null {
    return Object.prototype.hasOwnProperty.call(this.store, key)
      ? this.store[key]
      : null;
  }

  setItem(key: string, value: string): void {
    this.store[key] = value;
  }

  removeItem(key: string): void {
    delete this.store[key];
  }

  clear(): void {
    this.store = {};
  }
}

const localStorageMock = new LocalStorageMock();

beforeAll(() => {
  (global as Record<string, unknown>)['localStorage'] = localStorageMock;
});

beforeEach(() => {
  localStorageMock.clear();
  jest.restoreAllMocks();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CDN_URL = 'https://cdn.example.com/morphkit/dict.json';
const CACHE_KEY = 'morphkit_dictionary_cache';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Build a mock fetch that resolves successfully with the given dictionary. */
function mockFetchSuccess(dictionary: MorphkitDictionary = mockDictionary): jest.Mock {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: jest.fn().mockResolvedValue(dictionary),
  });
}

/** Build a mock fetch that rejects with a network error. */
function mockFetchFailure(message = 'Failed to fetch'): jest.Mock {
  return jest.fn().mockRejectedValue(new Error(message));
}

/** Build a mock fetch that resolves with a non-OK HTTP response. */
function mockFetchHttpError(status = 404, statusText = 'Not Found'): jest.Mock {
  return jest.fn().mockResolvedValue({ ok: false, status, statusText, json: jest.fn() });
}

/** Write an entry to the mock localStorage as if it was cached `ageMs` ago. */
function seedCache(dictionary: MorphkitDictionary = mockDictionary, ageMs = 0): void {
  const fetchedAt = new Date(Date.now() - ageMs).toISOString();
  localStorageMock.setItem(CACHE_KEY, JSON.stringify({ fetchedAt, dictionary }));
}

/** Flush all pending microtasks and one macrotask so background async work completes. */
const flushAsync = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

// ---------------------------------------------------------------------------
// AC-1: Cold start — no cache, fetch succeeds
// ---------------------------------------------------------------------------

describe('AC-1: cold start — fetches from CDN, populates localStorage, returns dictionary', () => {
  it('calls fetch with the provided CDN URL', async () => {
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    await syncDictionary(CDN_URL);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(CDN_URL);
  });

  it('returns the fetched dictionary', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess();

    const result = await syncDictionary(CDN_URL);

    expect(result).toEqual(mockDictionary);
  });

  it('writes the fetched dictionary to localStorage under the correct key', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess();

    await syncDictionary(CDN_URL);

    const raw = localStorageMock.getItem(CACHE_KEY);
    expect(raw).not.toBeNull();
    const cached = JSON.parse(raw!);
    expect(cached).toHaveProperty('fetchedAt');
    expect(cached).toHaveProperty('dictionary');
    expect(cached.dictionary).toEqual(mockDictionary);
  });

  it('stores a fetchedAt timestamp that is close to now', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess();
    const before = Date.now();

    await syncDictionary(CDN_URL);

    const after = Date.now();
    const cached = JSON.parse(localStorageMock.getItem(CACHE_KEY)!);
    const fetchedAt = new Date(cached.fetchedAt).getTime();
    expect(fetchedAt).toBeGreaterThanOrEqual(before);
    expect(fetchedAt).toBeLessThanOrEqual(after);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Fresh cache — returns instantly, no network request
// ---------------------------------------------------------------------------

describe('AC-2: fresh cache — returns cached dictionary without triggering a network request', () => {
  it('does not call fetch when the cache is 1 hour old', async () => {
    seedCache(mockDictionary, HOUR_MS);
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    await syncDictionary(CDN_URL);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the cached dictionary', async () => {
    seedCache(mockDictionary, HOUR_MS);
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess();

    const result = await syncDictionary(CDN_URL);

    expect(result).toEqual(mockDictionary);
  });

  it('does not call fetch when cache is 23 hours 59 minutes old', async () => {
    seedCache(mockDictionary, DAY_MS - HOUR_MS / 60);
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    await syncDictionary(CDN_URL);

    expect(fetch).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC-3: Offline + stale cache — returns stale, does not crash
// ---------------------------------------------------------------------------

describe('AC-3: offline with stale cache — returns stale dictionary gracefully', () => {
  it('does not throw when fetch fails and a stale cache exists', async () => {
    seedCache(mockDictionary, DAY_MS + HOUR_MS); // 25 hours old
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure();

    await expect(syncDictionary(CDN_URL)).resolves.toBeDefined();
  });

  it('returns the stale cached dictionary', async () => {
    seedCache(mockDictionary, DAY_MS + HOUR_MS);
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure();

    const result = await syncDictionary(CDN_URL);

    expect(result).toEqual(mockDictionary);
  });

  it('emits a console.warn after the background fetch fails', async () => {
    seedCache(mockDictionary, DAY_MS + HOUR_MS);
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure('Network offline');

    await syncDictionary(CDN_URL);
    await flushAsync(); // allow background promise rejection to propagate

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[Morphkit]'),
      expect.any(Error),
    );
  });
});

// ---------------------------------------------------------------------------
// REQ-6.3: Stale-while-revalidate — background fetch behaviour
// ---------------------------------------------------------------------------

describe('REQ-6.3: stale-while-revalidate', () => {
  it('returns stale dictionary immediately without waiting for the background fetch', async () => {
    seedCache(mockDictionary, DAY_MS + HOUR_MS);
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess();

    const result = await syncDictionary(CDN_URL);

    expect(result).toEqual(mockDictionary);
  });

  it('initiates a background fetch for the CDN URL', async () => {
    seedCache(mockDictionary, DAY_MS + HOUR_MS);
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    await syncDictionary(CDN_URL);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(CDN_URL);
  });

  it('updates localStorage after a successful background revalidation', async () => {
    const updatedDict: MorphkitDictionary = { ...mockDictionary, version: '2.0.0-updated' };
    seedCache(mockDictionary, DAY_MS + HOUR_MS);
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess(updatedDict);

    await syncDictionary(CDN_URL);
    await flushAsync(); // let background fetch + writeCache complete

    const cached = JSON.parse(localStorageMock.getItem(CACHE_KEY)!);
    expect(cached.dictionary.version).toBe('2.0.0-updated');
  });

  it('treats a cache at exactly 24 hours old as stale (not fresh)', async () => {
    seedCache(mockDictionary, DAY_MS);
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    await syncDictionary(CDN_URL);

    // A background fetch MUST have been initiated for the stale cache path
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// REQ-6.4 & REQ-6.5: Error handling
// ---------------------------------------------------------------------------

describe('REQ-6.5: cold-start network failure — throws DictionaryNetworkError', () => {
  it('throws DictionaryNetworkError when there is no cache and fetch rejects', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure('Failed to fetch');

    await expect(syncDictionary(CDN_URL)).rejects.toBeInstanceOf(DictionaryNetworkError);
  });

  it('throws DictionaryNetworkError when there is no cache and HTTP returns non-OK', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchHttpError(503, 'Service Unavailable');

    await expect(syncDictionary(CDN_URL)).rejects.toBeInstanceOf(DictionaryNetworkError);
  });

  it('error message contains the CDN URL so callers can surface it', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure('DNS lookup failed');

    const err = await syncDictionary(CDN_URL).catch((e: unknown) => e);

    expect((err as DictionaryNetworkError).message).toContain(CDN_URL);
  });

  it('error message contains the underlying cause description', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure('DNS lookup failed');

    const err = await syncDictionary(CDN_URL).catch((e: unknown) => e);

    expect((err as DictionaryNetworkError).message).toContain('DNS lookup failed');
  });

  it('error carries the original cause for programmatic inspection', async () => {
    const rootCause = new Error('DNS lookup failed');
    (global as Record<string, unknown>)['fetch'] = jest.fn().mockRejectedValue(rootCause);

    const err = await syncDictionary(CDN_URL).catch((e: unknown) => e);

    expect((err as DictionaryNetworkError).cause).toBe(rootCause);
  });

  it('error name is "DictionaryNetworkError"', async () => {
    (global as Record<string, unknown>)['fetch'] = mockFetchFailure();

    const err = await syncDictionary(CDN_URL).catch((e: unknown) => e);

    expect((err as Error).name).toBe('DictionaryNetworkError');
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Bonus: In-flight deduplication
// ---------------------------------------------------------------------------

describe('concurrent cold-start deduplication', () => {
  it('fires only one network request when called twice before the first resolves', async () => {
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    // Both calls start synchronously before any microtask yields; the second
    // call finds pendingColdStart already set and reuses it.
    const [r1, r2] = await Promise.all([
      syncDictionary(CDN_URL),
      syncDictionary(CDN_URL),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(r1).toEqual(mockDictionary);
    expect(r2).toEqual(mockDictionary);
  });

  it('both callers receive the same resolved dictionary', async () => {
    const unique: MorphkitDictionary = { ...mockDictionary, version: 'dedup-test' };
    (global as Record<string, unknown>)['fetch'] = mockFetchSuccess(unique);

    const [r1, r2] = await Promise.all([
      syncDictionary(CDN_URL),
      syncDictionary(CDN_URL),
    ]);

    expect(r1.version).toBe('dedup-test');
    expect(r2.version).toBe('dedup-test');
  });

  it('both callers receive DictionaryNetworkError when the shared fetch fails', async () => {
    const fetchMock = mockFetchFailure('CDN unreachable');
    (global as Record<string, unknown>)['fetch'] = fetchMock;

    const [e1, e2] = await Promise.all([
      syncDictionary(CDN_URL).catch((e: unknown) => e),
      syncDictionary(CDN_URL).catch((e: unknown) => e),
    ]);

    expect(e1).toBeInstanceOf(DictionaryNetworkError);
    expect(e2).toBeInstanceOf(DictionaryNetworkError);
    // Deduplication: one shared in-flight Promise → one network request, two rejections.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('allows a fresh request after the in-flight promise settles', async () => {
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    await syncDictionary(CDN_URL);          // first call — cold start, fills cache
    localStorageMock.clear();               // evict cache to force another cold start
    await syncDictionary(CDN_URL);          // second call — new cold start after first settled

    expect(fetch).toHaveBeenCalledTimes(2); // two separate requests, not deduplicated
  });
});

describe('edge cases', () => {
  it('treats a corrupt (unparseable) cache entry as a cold start and fetches', async () => {
    localStorageMock.setItem(CACHE_KEY, '{this is not valid json}');
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    const result = await syncDictionary(CDN_URL);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result).toEqual(mockDictionary);
  });

  it('treats a cache with a missing fetchedAt field as stale and triggers background fetch', async () => {
    // fetchedAt defaults to epoch when missing, making the entry always stale
    localStorageMock.setItem(CACHE_KEY, JSON.stringify({ dictionary: mockDictionary }));
    const fetch = mockFetchSuccess();
    (global as Record<string, unknown>)['fetch'] = fetch;

    const result = await syncDictionary(CDN_URL);

    // Returns cached dict immediately (stale path)
    expect(result).toEqual(mockDictionary);
    // Background fetch initiated
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
