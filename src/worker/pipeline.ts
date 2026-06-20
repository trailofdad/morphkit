import {
  CdnDictionary,
  GenotypeOutcome,
  InheritancePattern,
  LocusDictionaryEntry,
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
  NormalizedBreedingPair,
  NormalizedLocus,
} from '../types';
import { aggregateOutcomes } from '../aggregator';
import { computePunnettMatrix, validateHardyWeinberg } from '../engine';
import { normalizeInput } from '../validation';

/**
 * Maps MorphkitDictionary → CdnDictionary for MK-2.
 * The engine only uses CdnDictionary to detect sex-linked loci; non-sex-linked
 * entries are mapped to the nearest InheritancePattern equivalent.
 */
function deriveCdnDictionary(dictionary: MorphkitDictionary): CdnDictionary {
  return Object.values(dictionary.loci).map((locus): LocusDictionaryEntry => {
    let inheritancePattern: InheritancePattern;
    if (locus.isSexLinked) {
      inheritancePattern = 'sex-linked';
    } else if (locus.inheritance === 'incomplete_dominant') {
      inheritancePattern = 'co-dominant';
    } else if (locus.inheritance === 'polygenic') {
      inheritancePattern = 'recessive';
    } else {
      inheritancePattern = locus.inheritance as InheritancePattern;
    }
    return { locusId: locus.id, inheritancePattern };
  });
}

// ---------------------------------------------------------------------------
// Possible-het expansion (REQ-12)
//
// A `pos_het` parent is an unproven carrier: it carries the mutant with some
// probability rather than for certain. We expand each pos-het locus into a
// carrier branch (weight = carrierProbability) and a non-carrier branch
// (weight = 1 − carrierProbability), run MK-2 on every combination, then merge
// the weighted genotype distributions. The Punnett matrix and aggregator run
// unchanged. A DNA-proven positive collapses to `het` (no pos-het locus left);
// a proven negative is expressed by omitting the locus entirely.
// ---------------------------------------------------------------------------

interface PosHetRef {
  parent: 'sire' | 'dam';
  locusId: string;
  carrierProbability: number;
}

function collectPosHets(pair: NormalizedBreedingPair): PosHetRef[] {
  const refs: PosHetRef[] = [];
  for (const parent of ['sire', 'dam'] as const) {
    for (const locus of pair[parent].genotype) {
      if (locus.carrierProbability !== undefined) {
        refs.push({ parent, locusId: locus.locusId, carrierProbability: locus.carrierProbability });
      }
    }
  }
  return refs;
}

function setCarrierState(
  pair: NormalizedBreedingPair,
  parent: 'sire' | 'dam',
  locusId: string,
  carrier: boolean,
): NormalizedBreedingPair {
  const animal = pair[parent];
  const genotype = animal.genotype.map((l): NormalizedLocus => {
    if (l.locusId !== locusId) return l;
    const mutant = l.alleles.find((a) => a !== 'normal') ?? 'normal';
    const alleles: [string, string] = carrier ? [mutant, 'normal'] : ['normal', 'normal'];
    return { locusId: l.locusId, alleles }; // resolved to a definite genotype
  });
  return { ...pair, [parent]: { ...animal, genotype } };
}

function expandPosHetVariants(
  pair: NormalizedBreedingPair,
  posHets: PosHetRef[],
): { pair: NormalizedBreedingPair; weight: number }[] {
  let variants = [{ pair, weight: 1 }];
  for (const ph of posHets) {
    const next: typeof variants = [];
    for (const v of variants) {
      next.push({
        pair: setCarrierState(v.pair, ph.parent, ph.locusId, true),
        weight: v.weight * ph.carrierProbability,
      });
      next.push({
        pair: setCarrierState(v.pair, ph.parent, ph.locusId, false),
        weight: v.weight * (1 - ph.carrierProbability),
      });
    }
    variants = next;
  }
  return variants;
}

function outcomeKey(outcome: GenotypeOutcome): string {
  const lociPart = [...outcome.loci]
    .sort((a, b) => a.locusId.localeCompare(b.locusId))
    .map((l) => `${l.locusId}:${[...l.alleles].sort().join('|')}`)
    .join(';');
  return `${lociPart}~${outcome.sex ?? ''}`;
}

function mergeVariantOutcomes(
  variants: { pair: NormalizedBreedingPair; weight: number }[],
  cdnDictionary: CdnDictionary,
): GenotypeOutcome[] {
  const merged = new Map<string, GenotypeOutcome>();
  for (const { pair, weight } of variants) {
    if (weight === 0) continue;
    for (const outcome of computePunnettMatrix(pair, cdnDictionary)) {
      const key = outcomeKey(outcome);
      const scaled = outcome.decimalProbability * weight;
      const existing = merged.get(key);
      merged.set(
        key,
        existing
          ? { ...existing, decimalProbability: existing.decimalProbability + scaled }
          : { ...outcome, decimalProbability: scaled },
      );
    }
  }
  return [...merged.values()];
}

/**
 * MK-5 orchestration: runs the full MK-1 → MK-2 → MK-3/4 pipeline
 * synchronously and returns the final output. Throws on any validation
 * or engine error — callers are responsible for catching.
 */
export function runCalculationPipeline(
  input: MorphkitCalculationInput,
  dictionary: MorphkitDictionary,
): MorphkitCalculationOutput {
  const normalizedPair = normalizeInput(input, dictionary);
  const cdnDictionary = deriveCdnDictionary(dictionary);

  const posHets = collectPosHets(normalizedPair);
  let genotypeOutcomes: GenotypeOutcome[];
  if (posHets.length === 0) {
    genotypeOutcomes = computePunnettMatrix(normalizedPair, cdnDictionary);
  } else {
    genotypeOutcomes = mergeVariantOutcomes(
      expandPosHetVariants(normalizedPair, posHets),
      cdnDictionary,
    );
    validateHardyWeinberg(genotypeOutcomes);
  }

  const aggregatedOutcomes = aggregateOutcomes(genotypeOutcomes, normalizedPair, dictionary);

  return {
    outcomes: aggregatedOutcomes,
    normalizedInput: normalizedPair,
    calculatedAt: new Date().toISOString(),
  };
}
