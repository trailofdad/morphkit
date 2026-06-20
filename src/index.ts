import {
  CartesianMatrixError,
  InvalidGenotypeError,
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
  SchemaValidationError,
  WorkerCalculateMessage,
  WorkerErrorPayload,
  WorkerOutboundMessage,
  WorkerRequestId,
} from './types';
import { runCalculationPipeline } from './worker/pipeline';
import { resolveSimpleInput } from './simple';
import type { MorphResolution, SimpleCalculationInput } from './types';

// Minimal worker interface typed here so src/index.ts compiles without the
// WebWorker lib, which is dropped in the Jest/Node test environment.
interface BrowserWorker {
  onmessage: ((event: { data: WorkerOutboundMessage }) => void) | null;
  onerror: ((event: { message: string }) => void) | null;
  postMessage(message: WorkerCalculateMessage): void;
  terminate(): void;
}

// Access the Worker constructor via globalThis to avoid a TS compile error
// when lib does not include WebWorker (e.g., the Node/Jest test environment).
function spawnWorker(url: URL | string): BrowserWorker {
  const WorkerCtor = (globalThis as Record<string, unknown>)['Worker'] as new (
    url: URL | string,
    options?: { type?: string },
  ) => BrowserWorker;
  return new WorkerCtor(url, { type: 'module' });
}

/**
 * Executes the full Morphkit pipeline (MK-1 → MK-2 → MK-3/4) synchronously on
 * the calling thread and returns the result directly. No Web Worker, no
 * `workerUrl`, no bundler plumbing — suitable for SSR, Node scripts, unit tests,
 * and cheap client-side recalculations.
 *
 * Prefer {@link calculateMorphsAsync} when you want a large cross to run
 * off the main thread; otherwise this is the simplest entry point. Throws the
 * same typed errors the worker path serializes (`SchemaValidationError`,
 * `InvalidGenotypeError`, `CartesianMatrixError`) — catch them directly.
 *
 * @param input - The breeding pair and calculation settings.
 * @param dictionary - The MorphkitDictionary fetched by the caller.
 */
export function calculateMorphs(
  input: MorphkitCalculationInput,
  dictionary: MorphkitDictionary,
): MorphkitCalculationOutput {
  return runCalculationPipeline(input, dictionary);
}

/**
 * Simple tier: runs a full calculation from a per-parent list of morph **names**
 * instead of explicit genotypes. The names are desugared to a complex
 * `MorphkitCalculationInput` via {@link resolveSimpleInput} (dictionary- and
 * inheritance-aware), then the standard synchronous pipeline runs unchanged.
 *
 * Returns both the `output` and the per-morph `warnings` so a UI can surface any
 * ambiguous or unresolved names. Unresolved morphs are excluded from the cross.
 * Use {@link resolveSimpleInput} directly if you want to inspect or edit the
 * desugared complex input before calculating.
 */
export function calculateMorphsSimple(
  input: SimpleCalculationInput,
  dictionary: MorphkitDictionary,
): { output: MorphkitCalculationOutput; warnings: MorphResolution[] } {
  const { input: complex, warnings } = resolveSimpleInput(input, dictionary);
  return { output: runCalculationPipeline(complex, dictionary), warnings };
}

// ---------------------------------------------------------------------------
// Persistent worker pool (issue #21)
//
// calculateMorphsAsync used to spawn and terminate a Worker on every call, so
// each calculation paid full worker startup + teardown. Instead we keep one
// persistent worker per workerUrl and reuse it. Because a single worker can have
// several calculations in flight, every request carries a `requestId` the worker
// echoes back, and responses are routed to the matching caller. Idle workers
// self-terminate after WORKER_IDLE_TIMEOUT_MS; disposeWorkers() releases them
// explicitly. The synchronous calculateMorphs path is unaffected.
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (output: MorphkitCalculationOutput) => void;
  reject: (error: Error) => void;
}

interface PooledWorker {
  readonly worker: BrowserWorker;
  readonly pending: Map<WorkerRequestId, PendingRequest>;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
}

const pooledWorkers = new Map<string, PooledWorker>();
let nextRequestId = 0;

/** Idle period after which a worker with no in-flight requests is terminated. */
const WORKER_IDLE_TIMEOUT_MS = 30_000;

/** Rebuilds the typed error the worker serialized so callers catch the same class. */
function reviveWorkerError(payload: WorkerErrorPayload): Error {
  const { name, message, field, locusId, actualSum } = payload;
  if (name === 'SchemaValidationError') return new SchemaValidationError(message, field);
  if (name === 'InvalidGenotypeError') return new InvalidGenotypeError(message, locusId);
  if (name === 'CartesianMatrixError') return new CartesianMatrixError(message, actualSum);
  const error = new Error(message);
  error.name = name;
  return error;
}

function clearIdleTimer(entry: PooledWorker): void {
  if (entry.idleTimer !== undefined) {
    clearTimeout(entry.idleTimer);
    entry.idleTimer = undefined;
  }
}

/** Schedules teardown once the worker has no in-flight requests. */
function scheduleIdleTeardown(key: string, entry: PooledWorker): void {
  if (entry.pending.size > 0) return;
  clearIdleTimer(entry);
  entry.idleTimer = setTimeout(() => {
    // A request may have arrived after the timer was armed; only tear down if
    // the worker is still idle and still the one registered under this key.
    if (entry.pending.size === 0 && pooledWorkers.get(key) === entry) {
      entry.worker.terminate();
      pooledWorkers.delete(key);
    }
  }, WORKER_IDLE_TIMEOUT_MS);
  // Don't let an idle worker's timer keep a Node process / test runner alive.
  const timer = entry.idleTimer as unknown as { unref?: () => void };
  if (typeof timer.unref === 'function') timer.unref();
}

/** Terminates a pooled worker and rejects every request still in flight on it. */
function disposePooledWorker(key: string, entry: PooledWorker, reason: Error): void {
  clearIdleTimer(entry);
  pooledWorkers.delete(key);
  const pending = [...entry.pending.values()];
  entry.pending.clear();
  entry.worker.terminate();
  for (const request of pending) request.reject(reason);
}

/** Returns the persistent worker for a URL, creating and wiring one on first use. */
function getPooledWorker(workerUrl: URL | string): { key: string; entry: PooledWorker } {
  const key = String(workerUrl);
  const existing = pooledWorkers.get(key);
  if (existing) return { key, entry: existing };

  const entry: PooledWorker = { worker: spawnWorker(workerUrl), pending: new Map(), idleTimer: undefined };

  entry.worker.onmessage = ({ data: msg }): void => {
    const request = entry.pending.get(msg.requestId);
    if (!request) return; // unknown or already-settled id
    entry.pending.delete(msg.requestId);
    if (msg.type === 'SUCCESS') request.resolve(msg.output);
    else request.reject(reviveWorkerError(msg.error));
    scheduleIdleTeardown(key, entry);
  };

  // A worker-level crash invalidates the worker and every request on it.
  entry.worker.onerror = ({ message }): void => {
    disposePooledWorker(key, entry, new Error(message));
  };

  pooledWorkers.set(key, entry);
  return { key, entry };
}

/**
 * Executes the Morphkit genetic calculation pipeline asynchronously inside a
 * Web Worker and returns the result as a Promise.
 *
 * The worker is **persistent and reused** across calls keyed by `workerUrl`, so
 * rapid successive calls don't pay repeated worker startup/teardown. Several
 * calculations may be in flight on the same worker at once. An idle worker is
 * terminated automatically after ~30s; call {@link disposeWorkers} to release
 * workers eagerly (e.g. on teardown/unmount).
 *
 * @param input - The breeding pair and calculation settings.
 * @param dictionary - The MorphkitDictionary fetched by the main thread; passed
 *   directly into the worker so the worker never makes network requests.
 * @param workerUrl - URL of the compiled worker bundle. In a Vite/webpack SPA,
 *   pass `new URL('./morphkit.worker.js', import.meta.url)`.
 */
export function calculateMorphsAsync(
  input: MorphkitCalculationInput,
  dictionary: MorphkitDictionary,
  workerUrl: URL | string,
): Promise<MorphkitCalculationOutput> {
  return new Promise((resolve, reject) => {
    const { entry } = getPooledWorker(workerUrl);
    clearIdleTimer(entry); // about to be busy
    const requestId = nextRequestId++;
    entry.pending.set(requestId, { resolve, reject });
    entry.worker.postMessage({ type: 'CALCULATE', requestId, input, dictionary });
  });
}

/**
 * Terminates every pooled worker created by {@link calculateMorphsAsync} and
 * rejects any calculations still in flight. Call this when tearing down (e.g. on
 * unmount) to release workers immediately instead of waiting for the idle
 * timeout. Safe to call when no workers exist.
 */
export function disposeWorkers(): void {
  const reason = new Error('Worker pool disposed before the calculation completed');
  for (const [key, entry] of [...pooledWorkers.entries()]) {
    disposePooledWorker(key, entry, reason);
  }
}

export { resolveSimpleInput } from './simple';

export type {
  AggregatedOutcome,
  AnimalInput,
  AnimalSex,
  CalculationMode,
  CalculationWarning,
  CalculationWarningCode,
  GenotypeOutcome,
  LocusInput,
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
  MorphResolution,
  NormalizedBreedingPair,
  PossibleHet,
  SimpleAnimalInput,
  SimpleCalculationInput,
  SimpleResolution,
} from './types';

export {
  CartesianMatrixError,
  DictionaryNetworkError,
  InvalidGenotypeError,
  SchemaValidationError,
} from './types';

export { syncDictionary } from './network';
