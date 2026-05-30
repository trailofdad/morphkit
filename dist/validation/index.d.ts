import { MorphkitCalculationInput, NormalizedBreedingPair } from '../types';
/**
 * MK-1: Validates and normalizes a raw MorphkitCalculationInput.
 *
 * Responsibilities:
 *  - Enforce sex presence on both animals (REQ-1.2)
 *  - Default calculationMode to "standard" (REQ-1.3)
 *  - Reject loci with > 2 alleles (REQ-1.4)
 *  - Expand single-allele loci to [allele, "Normal"] (REQ-1.5)
 *  - Inject ["Normal", "Normal"] for loci missing from either animal (REQ-1.6)
 */
export declare function normalizeInput(input: MorphkitCalculationInput): NormalizedBreedingPair;
//# sourceMappingURL=index.d.ts.map