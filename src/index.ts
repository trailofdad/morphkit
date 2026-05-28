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
  ) => BrowserWorker;
  return new WorkerCtor(url);
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

export type {
  AggregatedOutcome,
  GenotypeOutcome,
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
  NormalizedBreedingPair,
  PossibleHet,
} from './types';

export {
  CartesianMatrixError,
  DictionaryNetworkError,
  InvalidGenotypeError,
  SchemaValidationError,
} from './types';

export { syncDictionary } from './network';
