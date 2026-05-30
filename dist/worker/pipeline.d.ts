import { MorphkitCalculationInput, MorphkitCalculationOutput, MorphkitDictionary } from '../types';
/**
 * MK-5 orchestration: runs the full MK-1 → MK-2 → MK-3/4 pipeline
 * synchronously and returns the final output. Throws on any validation
 * or engine error — callers are responsible for catching.
 */
export declare function runCalculationPipeline(input: MorphkitCalculationInput, dictionary: MorphkitDictionary): MorphkitCalculationOutput;
//# sourceMappingURL=pipeline.d.ts.map