import {
  CartesianMatrixError,
  InvalidGenotypeError,
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
  SchemaValidationError,
  WorkerCalculateMessage,
  WorkerOutboundMessage,
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

/**
 * Executes the Morphkit genetic calculation pipeline asynchronously inside a
 * Web Worker and returns the result as a Promise. The worker is terminated
 * after the calculation completes or fails.
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
    const worker = spawnWorker(workerUrl);

    worker.onmessage = ({ data: msg }): void => {
      worker.terminate();

      if (msg.type === 'SUCCESS') {
        resolve(msg.output);
        return;
      }

      const { name, message, field, locusId, actualSum } = msg.error;
      let error: Error;
      if (name === 'SchemaValidationError') {
        error = new SchemaValidationError(message, field);
      } else if (name === 'InvalidGenotypeError') {
        error = new InvalidGenotypeError(message, locusId);
      } else if (name === 'CartesianMatrixError') {
        error = new CartesianMatrixError(message, actualSum);
      } else {
        error = new Error(message);
        error.name = name;
      }
      reject(error);
    };

    worker.onerror = ({ message }): void => {
      worker.terminate();
      reject(new Error(message));
    };

    worker.postMessage({ type: 'CALCULATE', input, dictionary });
  });
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
