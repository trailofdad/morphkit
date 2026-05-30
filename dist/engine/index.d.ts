import { CdnDictionary, GenotypeOutcome, NormalizedBreedingPair } from '../types';
/**
 * MK-2: Executes the Cartesian Punnett Matrix over all loci in the
 * normalized breeding pair and returns deduplicated GenotypeOutcome[].
 *
 * Sex-linked loci (flagged in `dictionary`) bypass independent assortment:
 * sire alleles tagged `_MaleMaker` route exclusively to male offspring;
 * all other sire alleles on a sex-linked locus route to female offspring.
 *
 * Throws CartesianMatrixError if the sum of decimalProbability ≠ 1.0.
 */
export declare function computePunnettMatrix(pair: NormalizedBreedingPair, dictionary: CdnDictionary): GenotypeOutcome[];
/**
 * Validates Hardy-Weinberg equilibrium: the sum of all decimalProbability
 * values must equal exactly 1.0. Exported for direct unit testing (AC-3).
 */
export declare function validateHardyWeinberg(outcomes: GenotypeOutcome[]): void;
//# sourceMappingURL=index.d.ts.map