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

/** A running multi-locus outcome during the fold. */
interface PartialOutcome {
  readonly loci: readonly NormalizedLocus[];
  readonly probability: number;
  readonly sex?: AnimalSex;
}

/** One genotype in a single locus's probability distribution. */
interface LocusGenotype {
  readonly locus: NormalizedLocus;
  readonly probability: number;
  readonly sex?: AnimalSex;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * MK-2: Computes every possible offspring genotype for the normalized breeding
 * pair and returns them as GenotypeOutcome[].
 *
 * Rather than materializing the 4ⁿ raw-gamete fusion table and hash-deduping it,
 * the engine builds each locus's small genotype→probability distribution once
 * (≤3 genotypes autosomal, ≤4 sex-linked) and combines loci by **independent
 * assortment** — multiplying probabilities. Because each distribution is already
 * grouped and distinct loci never collide, the running set only ever holds the
 * true output size (≤3ⁿ), with no 4ⁿ intermediate and no global dedup map.
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
  // Index each parent's loci once so lookups inside the fold are O(1) rather
  // than a linear genotype.find per locus (was O(loci²)).
  const sireById = indexGenotype(pair.sire.genotype);
  const damById = indexGenotype(pair.dam.genotype);
  const sexLinked = sexLinkedLoci(dictionary);

  let combined: PartialOutcome[] = [{ loci: [], probability: 1 }];

  for (const { locusId } of pair.sire.genotype) {
    const sireLocus = requireLocus(sireById, locusId);
    const damLocus = requireLocus(damById, locusId);
    const distribution = sexLinked.has(locusId)
      ? buildSexLinkedDistribution(sireLocus, damLocus, pair.sire.sex)
      : buildAutosomalDistribution(sireLocus, damLocus);
    combined = combine(combined, distribution);
  }

  const outcomes = finalize(combined);

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
// Per-locus genotype distributions
// ---------------------------------------------------------------------------

/**
 * Autosomal locus: the 2×2 allele cross grouped into its ≤3 distinct genotypes,
 * each weighted by its share of the four equally-likely pairings (0.25 apiece).
 */
function buildAutosomalDistribution(
  sireLocus: NormalizedLocus,
  damLocus: NormalizedLocus,
): LocusGenotype[] {
  const groups = new Map<string, { alleles: [string, string]; probability: number }>();
  for (const sireAllele of sireLocus.alleles) {
    for (const damAllele of damLocus.alleles) {
      const alleles = sortPair(sireAllele, damAllele);
      addGrouped(groups, `${alleles[0]}|${alleles[1]}`, alleles, 0.25);
    }
  }
  return [...groups.values()].map(({ alleles, probability }) => ({
    locus: { locusId: sireLocus.locusId, alleles },
    probability,
  }));
}

/**
 * Sex-linked locus on the XX(♀)/XY(♂) system. The male contributes either his
 * X (→ daughter) or his Y (→ son); the female always contributes one of her two
 * X chromosomes. The four equally-likely outcomes (2 sons, 2 daughters) are
 * grouped by genotype+sex — correctly handling Male-Maker, Female-Maker,
 * het-female and Super states, since a mutant reaches an offspring through
 * whichever sex chromosome carries it.
 */
function buildSexLinkedDistribution(
  sireLocus: NormalizedLocus,
  damLocus: NormalizedLocus,
  sireSex: AnimalSex,
): LocusGenotype[] {
  // The heterogametic (XY) parent is the male; the homogametic (XX) parent is
  // the female. Identify by declared sex rather than the sire/dam slot.
  const maleLocus = sireSex === 'male' ? sireLocus : damLocus;
  const femaleLocus = sireSex === 'male' ? damLocus : sireLocus;
  const { xAllele, yAllele } = resolveMaleChromosomes(maleLocus);
  const locusId = sireLocus.locusId;

  const groups = new Map<
    string,
    { alleles: [string, string]; sex: AnimalSex; probability: number }
  >();
  for (const femaleX of femaleLocus.alleles) {
    // Son: Y from the male parent + an X from the female parent.
    const son = sortPair(yAllele, femaleX);
    addSexed(groups, son, 'male', 0.25);
    // Daughter: X from the male parent + an X from the female parent.
    const daughter = sortPair(xAllele, femaleX);
    addSexed(groups, daughter, 'female', 0.25);
  }
  return [...groups.values()].map(({ alleles, sex, probability }) => ({
    locus: { locusId, alleles },
    probability,
    sex,
  }));
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
// Multi-locus combination (independent assortment)
// ---------------------------------------------------------------------------

/**
 * Folds one locus's genotype distribution into the running outcome set: every
 * accumulated outcome pairs with every locus genotype, multiplying their
 * probabilities. A sex-linked locus that conflicts with an already-assigned sex
 * is dropped (two sex-linked loci cannot demand different sexes); finalize()
 * renormalizes for that dropped mass.
 */
function combine(
  accumulated: readonly PartialOutcome[],
  distribution: readonly LocusGenotype[],
): PartialOutcome[] {
  const result: PartialOutcome[] = [];
  for (const acc of accumulated) {
    for (const d of distribution) {
      if (acc.sex !== undefined && d.sex !== undefined && acc.sex !== d.sex) continue;
      result.push({
        loci: [...acc.loci, d.locus],
        probability: acc.probability * d.probability,
        sex: acc.sex ?? d.sex,
      });
    }
  }
  return result;
}

/**
 * Renormalizes any mass dropped by sex-conflict skips back to 1.0 (a no-op for
 * the common ≤1 sex-linked-locus case, where the total is already 1.0) and
 * projects the running outcomes to GenotypeOutcome[].
 */
function finalize(combined: readonly PartialOutcome[]): GenotypeOutcome[] {
  const total = combined.reduce((sum, o) => sum + o.probability, 0);
  const norm = total > 0 ? total : 1;
  return combined.map(
    (o): GenotypeOutcome => ({
      loci: o.loci.map((l) => ({ locusId: l.locusId, alleles: l.alleles })),
      decimalProbability: o.probability / norm,
      sex: o.sex,
    }),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addGrouped(
  groups: Map<string, { alleles: [string, string]; probability: number }>,
  key: string,
  alleles: [string, string],
  weight: number,
): void {
  const entry = groups.get(key);
  if (entry) entry.probability += weight;
  else groups.set(key, { alleles, probability: weight });
}

function addSexed(
  groups: Map<string, { alleles: [string, string]; sex: AnimalSex; probability: number }>,
  alleles: [string, string],
  sex: AnimalSex,
  weight: number,
): void {
  const key = `${alleles[0]}|${alleles[1]}~${sex}`;
  const entry = groups.get(key);
  if (entry) entry.probability += weight;
  else groups.set(key, { alleles, sex, probability: weight });
}

function indexGenotype(genotype: readonly NormalizedLocus[]): Map<string, NormalizedLocus> {
  const byId = new Map<string, NormalizedLocus>();
  for (const locus of genotype) byId.set(locus.locusId, locus);
  return byId;
}

function sexLinkedLoci(dictionary: CdnDictionary): Set<string> {
  const ids = new Set<string>();
  for (const entry of dictionary) {
    if (entry.inheritancePattern === 'sex-linked') ids.add(entry.locusId);
  }
  return ids;
}

function requireLocus(byId: Map<string, NormalizedLocus>, locusId: string): NormalizedLocus {
  const locus = byId.get(locusId);
  if (!locus) throw new Error(`Locus "${locusId}" missing from genotype — MK-1 symmetry violated`);
  return locus;
}

function sortPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}
