import { MorphkitCalculationInput, MorphkitCalculationOutput, MorphkitDictionary } from './types';
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
export declare function calculateMorphsAsync(input: MorphkitCalculationInput, dictionary: MorphkitDictionary, workerUrl: URL | string): Promise<MorphkitCalculationOutput>;
export type { AggregatedOutcome, AnimalInput, AnimalSex, CalculationMode, GenotypeOutcome, LocusInput, MorphkitCalculationInput, MorphkitCalculationOutput, MorphkitDictionary, NormalizedBreedingPair, PossibleHet, } from './types';
export { CartesianMatrixError, DictionaryNetworkError, InvalidGenotypeError, SchemaValidationError, } from './types';
export { syncDictionary } from './network';
//# sourceMappingURL=index.d.ts.map