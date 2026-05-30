import { AggregatedOutcome, GenotypeOutcome, MorphkitDictionary, NormalizedBreedingPair } from '../types';
/**
 * MK-3: Translates raw GenotypeOutcome[] into human-readable AggregatedOutcome[].
 *
 * Performs visual determination, poss-het math, combo matching, lethal flagging,
 * congenital warning collection, and polygenic injection. Returns outcomes sorted
 * by descending decimalProbability.
 */
export declare function aggregateOutcomes(outcomes: readonly GenotypeOutcome[], pair: NormalizedBreedingPair, dictionary: MorphkitDictionary): AggregatedOutcome[];
//# sourceMappingURL=index.d.ts.map