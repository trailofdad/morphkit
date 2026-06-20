import {
  CartesianMatrixError,
  InvalidGenotypeError,
  SchemaValidationError,
  WorkerCalculateMessage,
  WorkerErrorMessage,
  WorkerSuccessMessage,
} from '../types';
import { runCalculationPipeline } from './pipeline';

self.onmessage = (event: MessageEvent<WorkerCalculateMessage>): void => {
  const { type, requestId, input, dictionary } = event.data;

  if (type !== 'CALCULATE') return;

  try {
    const output = runCalculationPipeline(input, dictionary);
    const response: WorkerSuccessMessage = { type: 'SUCCESS', requestId, output };
    self.postMessage(response);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const response: WorkerErrorMessage = {
      type: 'ERROR',
      requestId,
      error: {
        name: error.name,
        message: error.message,
        ...(error instanceof SchemaValidationError && { field: error.field }),
        ...(error instanceof InvalidGenotypeError && { locusId: error.locusId }),
        ...(error instanceof CartesianMatrixError && { actualSum: error.actualSum }),
      },
    };
    self.postMessage(response);
  }
};
