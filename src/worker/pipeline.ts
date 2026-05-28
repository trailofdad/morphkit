import {
  CdnDictionary,
  InheritancePattern,
  LocusDictionaryEntry,
  MorphkitCalculationInput,
  MorphkitCalculationOutput,
  MorphkitDictionary,
} from '../types';
import { aggregateOutcomes } from '../aggregator';
import { computePunnettMatrix } from '../engine';
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

/**
 * MK-5 orchestration: runs the full MK-1 → MK-2 → MK-3/4 pipeline
 * synchronously and returns the final output. Throws on any validation
 * or engine error — callers are responsible for catching.
 */
export function runCalculationPipeline(
  input: MorphkitCalculationInput,
  dictionary: MorphkitDictionary,
): MorphkitCalculationOutput {
  const normalizedPair = normalizeInput(input);
  const cdnDictionary = deriveCdnDictionary(dictionary);
  const genotypeOutcomes = computePunnettMatrix(normalizedPair, cdnDictionary);
  const aggregatedOutcomes = aggregateOutcomes(genotypeOutcomes, normalizedPair, dictionary);

  return {
    outcomes: aggregatedOutcomes,
    normalizedInput: normalizedPair,
    calculatedAt: new Date().toISOString(),
  };
}
