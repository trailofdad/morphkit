import {
  AggregatedOutcome,
  CalculationMode,
  EpistasisRule,
  GenotypeOutcome,
  MorphkitDictionary,
  NormalizedBreedingPair,
  NormalizedLocus,
  PossibleHet,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNormal(alleleId: string): boolean {
  return alleleId === 'normal';
}

function isHomozygousMutant(alleles: readonly [string, string]): boolean {
  const [a, b] = alleles;
  return !isNormal(a) && a === b;
}

// REQ-3.1 / REQ-13: recessive AND polygenic → visual only if homozygous mutant
// (a polygenic causal locus is not dominant); dominant/incomplete_dominant →
// visual if any allele is mutant.
function isVisualAtLocus(alleles: readonly [string, string], inheritance: string): boolean {
  if (inheritance === 'recessive' || inheritance === 'polygenic') {
    return isHomozygousMutant(alleles);
  }
  const [a, b] = alleles;
  return !isNormal(a) || !isNormal(b);
}

function isCarrierAtLocus(alleles: readonly [string, string]): boolean {
  const [a, b] = alleles;
  return (!isNormal(a) && isNormal(b)) || (isNormal(a) && !isNormal(b));
}

// REQ-8: an incomplete-dominant homozygote is the distinct "Super" form, a third
// phenotype tier above wild-type and the single-gene het. Recessive homozygotes
// are the visual (not a "super"); a dominant super is indistinguishable by name.
const SUPER_PREFIX = 'Super ';

/** A resolved visual trait tagged with the locus it came from (for epistatic masking). */
interface VisualTrait {
  readonly locusId: string;
  readonly name: string;
}

function collectVisualTraits(
  loci: readonly NormalizedLocus[],
  dictionary: MorphkitDictionary,
  mode: CalculationMode,
): VisualTrait[] {
  // REQ-13: in diagnostic mode a polygenic group's member loci (DGa/DGb/DGc) do
  // not express on their own — they are gated below on the group's causal locus.
  const diagnostic = mode === 'diagnostic';
  const groups = dictionary.polygenicGroups ?? [];
  const gatedLoci = diagnostic ? new Set(groups.flatMap((g) => g.loci)) : new Set<string>();

  const traits: VisualTrait[] = [];
  for (const locus of loci) {
    if (gatedLoci.has(locus.locusId)) continue;
    const locusDef = dictionary.loci[locus.locusId];
    if (!locusDef || !isVisualAtLocus(locus.alleles, locusDef.inheritance)) continue;
    const [a, b] = locus.alleles;
    if (locusDef.inheritance === 'incomplete_dominant' && a === b && !isNormal(a)) {
      traits.push({
        locusId: locus.locusId,
        name: `${SUPER_PREFIX}${locusDef.alleles[a]?.name ?? a}`,
      });
      continue;
    }
    // Deduplicate mutant alleles (handles homozygous recessive where both alleles are identical)
    const mutants = [...new Set(locus.alleles.filter((x) => !isNormal(x)))];
    for (const alleleId of mutants) {
      traits.push({ locusId: locus.locusId, name: locusDef.alleles[alleleId]?.name ?? alleleId });
    }
  }

  // REQ-13 diagnostic gate: a polygenic group is visual only when its causal
  // locus is homozygous-mutant (DGc); DGa/DGb mutations alone read visually
  // normal. Standard mode never reaches here and uses the per-locus heuristic.
  if (diagnostic) {
    const byId = indexLoci(loci);
    for (const group of groups) {
      const causal = byId.get(group.causalLocus);
      if (causal && isHomozygousMutant(causal.alleles)) {
        traits.push({ locusId: group.causalLocus, name: group.visualLabel });
      }
    }
  }
  return traits;
}

/**
 * REQ-10: epistatic visual masking. When an epistasis rule's conditions all hold,
 * the named traits from its `suppressLoci` (or every trait, if `suppressAll`) are
 * removed and the rule's `label` is emitted instead. Only the visual list is
 * touched — genotype and congenital warnings are untouched, preserving downstream
 * crosses and safety flags. Rules apply in dictionary order.
 */
function applyEpistasis(
  traits: VisualTrait[],
  lociById: Map<string, NormalizedLocus>,
  dictionary: MorphkitDictionary,
): VisualTrait[] {
  let result = traits;
  for (const rule of dictionary.epistasisRules ?? []) {
    if (!epistasisMatches(rule, lociById)) continue;
    if (rule.suppressAll) {
      result = [];
    } else {
      const suppress = new Set(rule.suppressLoci ?? rule.conditions.map((c) => c.locusId));
      result = result.filter((t) => !suppress.has(t.locusId));
    }
    result = [...result, { locusId: rule.conditions[0]?.locusId ?? '', name: rule.label }];
  }
  return result;
}

function epistasisMatches(rule: EpistasisRule, lociById: Map<string, NormalizedLocus>): boolean {
  return rule.conditions.every((cond) => {
    const locus = lociById.get(cond.locusId);
    if (!locus) return false;
    const [a, b] = locus.alleles;
    if (cond.state === 'homozygous') {
      if (isNormal(a) || isNormal(b)) return false;
      return cond.allele ? a === cond.allele && b === cond.allele : true;
    }
    // 'present': at least one copy of the (optional) allele.
    if (cond.allele) return a === cond.allele || b === cond.allele;
    return !isNormal(a) || !isNormal(b);
  });
}

/** Indexes an outcome's loci by id for O(1) lookup across combo/lethal/defect scans. */
function indexLoci(loci: readonly NormalizedLocus[]): Map<string, NormalizedLocus> {
  const byId = new Map<string, NormalizedLocus>();
  for (const locus of loci) byId.set(locus.locusId, locus);
  return byId;
}

/**
 * True when every locus condition in `required` is satisfied by `lociById`,
 * comparing each allele pair order-independently. Shared by combo, lethal, and
 * defect-combo matching; takes a prebuilt id→locus map so a single outcome's
 * loci aren't re-scanned once per dictionary entry.
 */
function genotypeMatches(
  lociById: Map<string, NormalizedLocus>,
  required: Record<string, [string, string]>,
): boolean {
  return Object.entries(required).every(([locusId, [ra, rb]]) => {
    const locus = lociById.get(locusId);
    if (!locus) return false;
    const [a, b] = locus.alleles;
    return (a === ra && b === rb) || (a === rb && b === ra);
  });
}

function collectCongenitalWarnings(
  loci: readonly NormalizedLocus[],
  lociById: Map<string, NormalizedLocus>,
  dictionary: MorphkitDictionary,
): string[] {
  const warnings = new Set<string>();
  for (const locus of loci) {
    const locusDef = dictionary.loci[locus.locusId];
    if (!locusDef) continue;
    const [a, b] = locus.alleles;
    for (const alleleId of locus.alleles) {
      for (const d of locusDef.alleles[alleleId]?.defects ?? []) warnings.add(d);
    }
    // REQ-11: super-only defects fire just in the homozygous-mutant state.
    if (a === b && !isNormal(a)) {
      for (const d of locusDef.alleles[a]?.superDefects ?? []) warnings.add(d);
    }
  }
  // REQ-11: combination-triggered congenital defects (e.g. Bug Eyes, Duckbilling).
  for (const { triggerGenotype, defects } of dictionary.defectCombos ?? []) {
    if (genotypeMatches(lociById, triggerGenotype)) {
      for (const d of defects) warnings.add(d);
    }
  }
  return [...warnings];
}

function isLethalOutcome(
  lociById: Map<string, NormalizedLocus>,
  dictionary: MorphkitDictionary,
): boolean {
  return dictionary.lethalCombos.some(({ triggerGenotype }) =>
    genotypeMatches(lociById, triggerGenotype),
  );
}

// REQ-3.3: Returns the matching combo's marketName, or undefined if no match.
function matchCombo(
  lociById: Map<string, NormalizedLocus>,
  dictionary: MorphkitDictionary,
): string | undefined {
  return dictionary.combos.find(({ requiredGenotype }) =>
    genotypeMatches(lociById, requiredGenotype),
  )?.marketName;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * MK-3: Translates raw GenotypeOutcome[] into human-readable AggregatedOutcome[].
 *
 * Performs visual determination, poss-het math, combo matching, lethal flagging,
 * congenital warning collection, and polygenic injection. Returns outcomes sorted
 * by descending decimalProbability.
 */
export function aggregateOutcomes(
  outcomes: readonly GenotypeOutcome[],
  pair: NormalizedBreedingPair,
  dictionary: MorphkitDictionary,
): AggregatedOutcome[] {
  // REQ-3.4: Deduplicated polygenics from both parents, injected into every outcome.
  const polygenics = [...new Set([...pair.sire.polygenics, ...pair.dam.polygenics])];

  // REQ-3.2: Precompute MARGINAL carrier and non-visual probability per recessive locus.
  //
  // Poss-het % must be a locus-level conditional probability:
  //   P(carrier at locus | non-visual at locus) = marginalCarrier / marginalNonVisual
  //
  // Using a full-genome outcome probability as the numerator was wrong: in a
  // multi-locus cross each individual outcome's probability is a fraction of the
  // product of all locus probabilities, so the ratio produced values like 13%
  // instead of the expected Mendelian 100%/66%/50%.  By marginalising across
  // all outcomes we recover a number that is independent of every other locus
  // (independent assortment) and matches standard Punnett-square expectations.
  const locusMargins = new Map<string, { nonVisual: number; carrier: number }>();
  for (const outcome of outcomes) {
    for (const locus of outcome.loci) {
      const locusDef = dictionary.loci[locus.locusId];
      if (!locusDef || locusDef.inheritance !== 'recessive') continue;
      if (isVisualAtLocus(locus.alleles, 'recessive')) continue;
      const m = locusMargins.get(locus.locusId) ?? { nonVisual: 0, carrier: 0 };
      m.nonVisual += outcome.decimalProbability;
      if (isCarrierAtLocus(locus.alleles)) m.carrier += outcome.decimalProbability;
      locusMargins.set(locus.locusId, m);
    }
  }

  const aggregated = outcomes.map((outcome): AggregatedOutcome => {
    const lociById = indexLoci(outcome.loci);
    const visualTraits = collectVisualTraits(outcome.loci, dictionary, pair.calculationMode);
    // REQ-10: apply epistatic visual masking after per-locus collection.
    const phenotypeNames = applyEpistasis(visualTraits, lociById, dictionary).map((t) => t.name);
    const possibleHets: PossibleHet[] = [];

    for (const locus of outcome.loci) {
      const locusDef = dictionary.loci[locus.locusId];
      if (!locusDef || locusDef.inheritance !== 'recessive') continue;
      if (isVisualAtLocus(locus.alleles, 'recessive') || !isCarrierAtLocus(locus.alleles)) continue;

      const m = locusMargins.get(locus.locusId);
      const probability = m && m.nonVisual > 0 ? m.carrier / m.nonVisual : 0;
      possibleHets.push({ locusId: locus.locusId, probability, isGuaranteed: probability >= 1.0 });
    }

    const comboName =
      matchCombo(lociById, dictionary) ??
      (phenotypeNames.length > 0 ? phenotypeNames.join(' ') : undefined);

    return {
      genotype: outcome,
      phenotypeNames,
      comboName,
      decimalProbability: outcome.decimalProbability,
      percentageProbability: `${Math.round(outcome.decimalProbability * 100)}%`,
      possibleHets,
      isLethal: isLethalOutcome(lociById, dictionary),
      congenitalWarnings: collectCongenitalWarnings(outcome.loci, lociById, dictionary),
      sex: outcome.sex,
      polygenics,
    };
  });

  return aggregated.sort((a, b) => b.decimalProbability - a.decimalProbability);
}
