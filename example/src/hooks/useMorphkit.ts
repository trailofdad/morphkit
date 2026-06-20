import { useState, useCallback } from 'react';
// Vite's ?worker suffix bundles the worker file and returns a typed constructor
import MorphkitWorker from '../../../src/worker/morphkit.worker.ts?worker';
import type {
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
  WorkerCalculateMessage,
  WorkerOutboundMessage,
} from '../../../src/types';

interface UseMorphkitReturn {
  calculateMorphsAsync: (
    input: MorphkitCalculationInput,
    dictionary: MorphkitDictionary,
  ) => Promise<MorphkitCalculationOutput>;
  isCalculating: boolean;
  error: string | null;
}

export function useMorphkit(): UseMorphkitReturn {
  const [isCalculating, setIsCalculating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculateMorphsAsync = useCallback(
    (
      input: MorphkitCalculationInput,
      dictionary: MorphkitDictionary,
    ): Promise<MorphkitCalculationOutput> => {
      setIsCalculating(true);
      setError(null);

      return new Promise((resolve, reject) => {
        const worker = new MorphkitWorker();

        worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
          worker.terminate();
          setIsCalculating(false);
          const msg = event.data;
          if (msg.type === 'SUCCESS') {
            resolve(msg.output);
          } else {
            setError(msg.error.message);
            reject(new Error(msg.error.message));
          }
        };

        worker.onerror = (event: ErrorEvent) => {
          worker.terminate();
          setIsCalculating(false);
          setError(event.message);
          reject(new Error(event.message));
        };

        const message: WorkerCalculateMessage = {
          // This hook spawns a dedicated one-shot worker per call, so a constant
          // requestId is fine; the library's pooled calculateMorphsAsync assigns a
          // unique id per call to multiplex a persistent worker.
          type: 'CALCULATE',
          requestId: 0,
          input,
          dictionary,
        };
        worker.postMessage(message);
      });
    },
    [],
  );

  return { calculateMorphsAsync, isCalculating, error };
}
