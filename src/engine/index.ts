import {
  AnimalSex,
  CartesianMatrixError,
  CdnDictionary,
  GenotypeOutcome,
  NormalizedBreedingPair,
  NormalizedLocus,
} from '../types';

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface PartialOutcome {
  readonly loci: readonly NormalizedLocus[];
  readonly sex?: AnimalSex;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * MK-2: Executes the Cartesian Punnett Matrix over all loci in the
 * normalized breeding pair and returns deduplicated GenotypeOutcome[].
 *
 * Sex-linked loci (flagged in `dictionary`) bypass independent assortment and
 * are modeled on the XX/XY sex-determination system: offspring sex is set by
 * which sex chromosome the heterogametic (male) parent contributes — Y → son,
 * X → daughter — independent of the morph. A mutant allele then reaches an
 * offspring via whichever sex chromosome (from either parent) carries it.
 *
 * Throws CartesianMatrixError if the sum of decimalProbability ≠ 1.0.
 */
export function computePunnettMatrix(
  pair: NormalizedBreedingPair,
  dictionary: CdnDictionary,
): GenotypeOutcome[] {
  // Start with a single empty partial outcome, then fold each locus in.
  let combined: PartialOutcome[] = [{ loci: [] }];

  for (const { locusId } of pair.sire.genotype) {
    const sireLocus = requireLocus(pair.sire.genotype, locusId);
    const damLocus = requireLocus(pair.dam.genotype, locusId);
    const matrix = isSexLinked(locusId, dictionary)
      ? buildSexLinkedMatrix(sireLocus, damLocus, pair.sire.sex)
      : buildAutosomalMatrix(sireLocus, damLocus);
    combined = crossProduct(combined, matrix);
  }

  const totalRaw = combined.length;
  const outcomes = deduplicate(combined, totalRaw);

  validateHardyWeinberg(outcomes);

  return outcomes;
}

/**
 * Tolerance for the Hardy-Weinberg sum check. Outcome probabilities are summed
 * from per-outcome fractions; once any locus yields a non-power-of-two
 * denominator (sex-conflict skips, future weighted/crossover splits), the sum
 * can land an ULP off 1.0. A genuine mapping error (a mis-assigned allelic
 * complex) deviates by far more than this, so an epsilon preserves the check's
 * intent while removing false positives on valid crosses.
 */
const HARDY_WEINBERG_EPSILON = 1e-9;

/**
 * Validates Hardy-Weinberg equilibrium: the sum of all decimalProbability
 * values must equal 1.0 within HARDY_WEINBERG_EPSILON. Exported for direct
 * unit testing (AC-3).
 */
export function validateHardyWeinberg(outcomes: GenotypeOutcome[]): void {
  const sum = outcomes.reduce((acc, o) => acc + o.decimalProbability, 0);
  if (Math.abs(sum - 1.0) > HARDY_WEINBERG_EPSILON) {
    throw new CartesianMatrixError(
      `Hardy-Weinberg violation: probability sum is ${sum}, expected 1.0`,
      sum,
    );
  }
}

// ---------------------------------------------------------------------------
// Per-locus 2×2 matrix
// ---------------------------------------------------------------------------

/** Autosomal locus: full 4-way Cartesian product of the two parents' alleles. */
function buildAutosomalMatrix(
  sireLocus: NormalizedLocus,
  damLocus: NormalizedLocus,
): PartialOutcome[] {
  const outcomes: PartialOutcome[] = [];
  for (const sireAllele of sireLocus.alleles) {
    for (const damAllele of damLocus.alleles) {
      outcomes.push({
        loci: [{ locusId: sireLocus.locusId, alleles: sortPair(sireAllele, damAllele) }],
      });
    }
  }
  return outcomes; // always 4 raw outcomes per locus
}

/**
 * Sex-linked locus on the XX(♀)/XY(♂) system. The male contributes either his
 * X (→ daughter) or his Y (→ son); the female always contributes one of her two
 * X chromosomes. This yields 4 equally-likely outcomes (2 sons, 2 daughters) and
 * correctly handles Male-Maker, Female-Maker, het-female and Super states — a
 * mutant reaches an offspring through whichever sex chromosome carries it.
 */
function buildSexLinkedMatrix(
  sireLocus: NormalizedLocus,
  damLocus: NormalizedLocus,
  sireSex: AnimalSex,
): PartialOutcome[] {
  // The heterogametic (XY) parent is the male; the homogametic (XX) parent is
  // the female. Identify by declared sex rather than the sire/dam slot.
  const maleLocus = sireSex === 'male' ? sireLocus : damLocus;
  const femaleLocus = sireSex === 'male' ? damLocus : sireLocus;
  const { xAllele, yAllele } = resolveMaleChromosomes(maleLocus);
  const locusId = sireLocus.locusId;

  const outcomes: PartialOutcome[] = [];
  for (const femaleX of femaleLocus.alleles) {
    // Son: Y from the male parent + an X from the female parent.
    outcomes.push({ loci: [{ locusId, alleles: sortPair(yAllele, femaleX) }], sex: 'male' });
    // Daughter: X from the male parent + an X from the female parent.
    outcomes.push({ loci: [{ locusId, alleles: sortPair(xAllele, femaleX) }], sex: 'female' });
  }
  return outcomes; // always 4 raw outcomes per locus
}

/**
 * Resolves which allele rides the male's X vs Y chromosome. Uses the explicit
 * `sexChromosomes` annotation when present; otherwise a mutant allele defaults to
 * the Y (Male-Maker), the iconic Banana case. For a wild-type or homozygous male
 * the assignment is symmetric, so the default is harmless.
 */
function resolveMaleChromosomes(locus: NormalizedLocus): {
  xAllele: string;
  yAllele: string;
} {
  const [a, b] = locus.alleles;
  if (locus.sexChromosomes) {
    const [ca] = locus.sexChromosomes;
    return ca === 'X' ? { xAllele: a, yAllele: b } : { xAllele: b, yAllele: a };
  }
  const aMutant = a !== 'normal';
  const bMutant = b !== 'normal';
  if (aMutant && !bMutant) return { xAllele: b, yAllele: a };
  if (bMutant && !aMutant) return { xAllele: a, yAllele: b };
  return { xAllele: a, yAllele: b };
}

// ---------------------------------------------------------------------------
// Global Cartesian product (REQ-2.3)
// ---------------------------------------------------------------------------

function crossProduct(
  accumulated: readonly PartialOutcome[],
  next: readonly PartialOutcome[],
): PartialOutcome[] {
  const result: PartialOutcome[] = [];

  for (const acc of accumulated) {
    for (const n of next) {
      // Biologically impossible: two sex-linked loci assigning conflicting sexes.
      if (acc.sex !== undefined && n.sex !== undefined && acc.sex !== n.sex) continue;
      result.push({ loci: [...acc.loci, ...n.loci], sex: acc.sex ?? n.sex });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Deduplication & aggregation (REQ-2.4 / REQ-2.5)
// ---------------------------------------------------------------------------

function deduplicate(outcomes: readonly PartialOutcome[], totalRaw: number): GenotypeOutcome[] {
  const countMap = new Map<string, { outcome: PartialOutcome; count: number }>();

  for (const outcome of outcomes) {
    const key = outcomeKey(outcome);
    const entry = countMap.get(key);
    if (entry) {
      entry.count++;
    } else {
      countMap.set(key, { outcome, count: 1 });
    }
  }

  return Array.from(countMap.values()).map(
    ({ outcome, count }): GenotypeOutcome => ({
      loci: outcome.loci.map((l) => ({ locusId: l.locusId, alleles: l.alleles })),
      decimalProbability: count / totalRaw,
      sex: outcome.sex,
    }),
  );
}

function outcomeKey(outcome: PartialOutcome): string {
  const lociPart = [...outcome.loci]
    .sort((a, b) => a.locusId.localeCompare(b.locusId))
    .map((l) => `${l.locusId}:${l.alleles[0]}|${l.alleles[1]}`)
    .join(';');
  return `${lociPart}~${outcome.sex ?? ''}`;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isSexLinked(locusId: string, dictionary: CdnDictionary): boolean {
  return dictionary.find((e) => e.locusId === locusId)?.inheritancePattern === 'sex-linked';
}

function requireLocus(genotype: readonly NormalizedLocus[], locusId: string): NormalizedLocus {
  const locus = genotype.find((l) => l.locusId === locusId);
  if (!locus) throw new Error(`Locus "${locusId}" missing from genotype — MK-1 symmetry violated`);
  return locus;
}

function sortPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}
