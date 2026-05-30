import { MorphkitDictionary } from '../types';
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
export declare function syncDictionary(cdnUrl: string): Promise<MorphkitDictionary>;
//# sourceMappingURL=index.d.ts.map