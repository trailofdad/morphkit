import {
  AggregatedOutcome,
  AnimalSex,
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

/**
 * REQ-3.3: Collapses registered market combos into the visual-trait list.
 *
 * A combo (e.g. Freeway = yellowbelly + asphalt) is a market name for a specific
 * multi-allele genotype. The previous implementation took the *first* combo whose
 * required genotype was a subset of the outcome, so a "Pastel Freeway" was
 * mislabeled just "Freeway" and, because it used `Array.find`, the winner was
 * dictionary-order-dependent. Instead we match every satisfied combo, prefer the
 * ones covering the **most loci** (most specific first, name-tiebroken for
 * determinism), and greedily consume loci so combos never overlap. Each selected
 * combo replaces the individual traits on its loci with the single market name;
 * traits on loci no combo covers pass through untouched. The result composes —
 * "Freeway" (yellowbelly complex) sits alongside a leftover "Pastel".
 *
 * Runs before epistasis so a masking rule still sees (and can suppress) the
 * combo's representative locus. A combo is only applied when every one of its
 * loci is actually an expressed visual here; combos gated on a non-visual (het)
 * component fall through to the individual traits.
 */
function applyCombos(
  traits: readonly VisualTrait[],
  lociById: Map<string, NormalizedLocus>,
  dictionary: MorphkitDictionary,
): VisualTrait[] {
  const present = new Set(traits.map((t) => t.locusId));
  const candidates = dictionary.combos
    .map((combo) => ({ combo, loci: Object.keys(combo.requiredGenotype) }))
    .filter(
      ({ combo, loci }) =>
        loci.every((l) => present.has(l)) && genotypeMatches(lociById, combo.requiredGenotype),
    )
    .sort(
      (a, b) => b.loci.length - a.loci.length || a.combo.marketName.localeCompare(b.combo.marketName),
    );

  const consumed = new Set<string>();
  const selected: VisualTrait[] = [];
  for (const { combo, loci } of candidates) {
    if (loci.some((l) => consumed.has(l))) continue; // overlaps an already-picked combo
    for (const l of loci) consumed.add(l);
    selected.push({ locusId: loci[0], name: combo.marketName });
  }
  if (selected.length === 0) return [...traits];

  // Combos first (they read as the headline), then any traits no combo covered.
  return [...selected, ...traits.filter((t) => !consumed.has(t.locusId))];
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
    // REQ-3.3: collapse registered market combos into the trait list, then
    // REQ-10: apply epistatic visual masking on top.
    const withCombos = applyCombos(visualTraits, lociById, dictionary);
    const phenotypeNames = applyEpistasis(withCombos, lociById, dictionary).map((t) => t.name);
    const possibleHets: PossibleHet[] = [];

    for (const locus of outcome.loci) {
      const locusDef = dictionary.loci[locus.locusId];
      if (!locusDef || locusDef.inheritance !== 'recessive') continue;
      if (isVisualAtLocus(locus.alleles, 'recessive') || !isCarrierAtLocus(locus.alleles)) continue;

      const m = locusMargins.get(locus.locusId);
      const probability = m && m.nonVisual > 0 ? m.carrier / m.nonVisual : 0;
      possibleHets.push({ locusId: locus.locusId, probability, isGuaranteed: probability >= 1.0 });
    }

    // Combos are already folded into phenotypeNames by applyCombos, so the
    // outcome's market label is simply the joined visual names (undefined when
    // all-Normal). This stays correct for "Pastel Freeway" — two names joined —
    // where the old single-combo lookup could only ever emit "Freeway".
    const comboName = phenotypeNames.length > 0 ? phenotypeNames.join(' ') : undefined;

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

// ---------------------------------------------------------------------------
// Phenotype-grouped view (MK-4): one row per visible outcome
// ---------------------------------------------------------------------------

/** A possible-het on a folded phenotype row: P(carrier at locus | this phenotype). */
export interface PhenotypeHet {
  readonly locusId: string;
  /** Conditional carrier probability given the folded phenotype, 0–1. */
  readonly probability: number;
}

/**
 * One visible phenotype with every genotype that produces it collapsed in. This
 * is the "what will the clutch actually look like" view — the per-genotype
 * {@link AggregatedOutcome}s folded so a single visual combo appears once instead
 * of repeating per hidden-het permutation.
 */
export interface PhenotypeOutcome {
  readonly phenotypeNames: readonly string[];
  /** Market label — the joined phenotype names, or undefined for all-Normal. */
  readonly comboName?: string;
  /** Summed probability across every genotype folded into this phenotype. */
  readonly decimalProbability: number;
  readonly percentageProbability: string;
  /** Possible-hets re-derived as P(carrier | phenotype), sorted most-likely first. */
  readonly possibleHets: readonly PhenotypeHet[];
  readonly isLethal: boolean;
  readonly congenitalWarnings: readonly string[];
  readonly sex?: AnimalSex;
  readonly polygenics: readonly string[];
}

/** Grouping key for {@link aggregateByPhenotype}: the sorted visual names plus sex. */
function phenotypeKey(o: { phenotypeNames: readonly string[]; sex?: AnimalSex }): string {
  return `${[...o.phenotypeNames].sort().join('|')}~${o.sex ?? ''}`;
}

/**
 * Folds per-genotype {@link AggregatedOutcome}s into one row per visible
 * phenotype (+ sex). The engine emits a distinct outcome for every genotype, so
 * one visible combo repeats once per hidden-het permutation; most UIs want the
 * collapsed view. Within each group this sums the probabilities and re-derives
 * every possible-het as a conditional `P(carrier at locus | this phenotype)` —
 * every member of a group is non-visual at that locus, so the conditional is the
 * carrier members' mass over the group's total mass, yielding the standard "66%
 * Het" for a het × het cross shown once per locus. Rows are sorted most-visual-
 * traits first, then by descending probability.
 */
export function aggregateByPhenotype(
  outcomes: readonly AggregatedOutcome[],
): PhenotypeOutcome[] {
  const groups = new Map<string, AggregatedOutcome[]>();
  for (const o of outcomes) {
    const key = phenotypeKey(o);
    const bucket = groups.get(key);
    if (bucket) bucket.push(o);
    else groups.set(key, [o]);
  }

  const folded: PhenotypeOutcome[] = [];
  for (const members of groups.values()) {
    const total = members.reduce((s, m) => s + m.decimalProbability, 0);

    const carrierMass = new Map<string, number>();
    for (const m of members) {
      for (const h of m.possibleHets) {
        carrierMass.set(h.locusId, (carrierMass.get(h.locusId) ?? 0) + m.decimalProbability);
      }
    }
    const possibleHets: PhenotypeHet[] = [...carrierMass.entries()]
      .map(([locusId, mass]) => ({ locusId, probability: total > 0 ? mass / total : 0 }))
      .sort((a, b) => b.probability - a.probability);

    const rep = members[0];
    folded.push({
      phenotypeNames: rep.phenotypeNames,
      comboName: rep.comboName,
      decimalProbability: total,
      percentageProbability: `${Math.round(total * 100)}%`,
      possibleHets,
      isLethal: members.some((m) => m.isLethal),
      congenitalWarnings: [...new Set(members.flatMap((m) => m.congenitalWarnings))],
      sex: rep.sex,
      polygenics: rep.polygenics,
    });
  }

  return folded.sort(
    (a, b) =>
      b.phenotypeNames.length - a.phenotypeNames.length ||
      b.decimalProbability - a.decimalProbability,
  );
}
