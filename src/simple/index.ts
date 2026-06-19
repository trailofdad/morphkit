import {
  AnimalInput,
  ComboDefinition,
  InheritanceType,
  LocusInput,
  MorphkitCalculationInput,
  MorphkitDictionary,
  MorphResolution,
  SimpleAnimalInput,
  SimpleCalculationInput,
  SimpleResolution,
} from '../types';

/**
 * Simple tier (pre-MK-1): converts a per-parent `morphs: string[]` list into a
 * standard complex `MorphkitCalculationInput`, then the caller runs the existing
 * MK-1 → MK-2 → MK-3/4 pipeline unchanged. This is a thin name-resolution
 * front-end — it owns **no** Punnett or aggregation logic.
 *
 * Because a bare morph name carries no zygosity, resolution is inheritance-aware
 * (see the dictionary's `inheritance` per locus) and case-insensitive, and it
 * returns a per-morph `MorphResolution` so a UI can see which inputs were
 * ambiguous or unresolved. Unresolved morphs are excluded from the cross.
 */
export function resolveSimpleInput(
  input: SimpleCalculationInput,
  dictionary: MorphkitDictionary,
): SimpleResolution {
  const index = buildNameIndex(dictionary);
  const sire = resolveAnimal(input.sire, 'sire', index);
  const dam = resolveAnimal(input.dam, 'dam', index);

  const complex: MorphkitCalculationInput = {
    ...(input.calculationMode ? { calculationMode: input.calculationMode } : {}),
    sire: sire.input,
    dam: dam.input,
  };

  return { input: complex, warnings: [...sire.warnings, ...dam.warnings] };
}

// ---------------------------------------------------------------------------
// Dictionary name index
// ---------------------------------------------------------------------------

interface AlleleCandidate {
  readonly locusId: string;
  readonly alleleId: string;
  readonly alleleName: string;
  readonly inheritance: InheritanceType;
}

interface NameIndex {
  /** lowercased allele name/id/alias/shortName → distinct candidates (>1 ⇒ ambiguous). */
  readonly alleles: Map<string, AlleleCandidate[]>;
  /** lowercased combo marketName/alias/shortName → combo. */
  readonly combos: Map<string, ComboDefinition>;
}

function buildNameIndex(dictionary: MorphkitDictionary): NameIndex {
  const alleles = new Map<string, AlleleCandidate[]>();
  const combos = new Map<string, ComboDefinition>();

  const addAllele = (key: string, candidate: AlleleCandidate): void => {
    const list = alleles.get(key) ?? [];
    if (!list.some((c) => c.locusId === candidate.locusId && c.alleleId === candidate.alleleId)) {
      list.push(candidate);
    }
    alleles.set(key, list);
  };

  for (const [locusId, locus] of Object.entries(dictionary.loci)) {
    for (const [alleleId, allele] of Object.entries(locus.alleles)) {
      if (alleleId === 'normal') continue;
      const candidate: AlleleCandidate = {
        locusId,
        alleleId,
        alleleName: allele.name ?? alleleId,
        inheritance: locus.inheritance,
      };
      addAllele(alleleId.toLowerCase(), candidate);
      if (allele.name) addAllele(allele.name.toLowerCase(), candidate);
      for (const alias of allele.aliases ?? []) addAllele(alias.toLowerCase(), candidate);
      for (const short of allele.shortNames ?? []) addAllele(short.toLowerCase(), candidate);
    }
  }

  const addCombo = (key: string, combo: ComboDefinition): void => {
    if (!combos.has(key)) combos.set(key, combo);
  };
  for (const combo of dictionary.combos) {
    addCombo(combo.marketName.toLowerCase(), combo);
    for (const alias of combo.aliases ?? []) addCombo(alias.toLowerCase(), combo);
    for (const short of combo.shortNames ?? []) addCombo(short.toLowerCase(), combo);
  }

  return { alleles, combos };
}

// ---------------------------------------------------------------------------
// Per-morph resolution
// ---------------------------------------------------------------------------

/** A morph's desugared genotype contribution: a [a, b] pair on a single locus. */
interface Contribution {
  readonly locusId: string;
  readonly pair: [string, string];
}

interface ResolvedMorph {
  /** Per-morph result (parent is attached by the caller). */
  readonly resolution: Omit<MorphResolution, 'parent'>;
  readonly contributions: Contribution[];
}

function parsePrefix(raw: string): { kind: 'het' | 'super' | 'none'; rest: string } {
  // "Het X", "Possible Het X", "Poss Het X", "66% Het X" → het; "Super X" → super.
  const het = raw.match(/^(?:possible\s+het|poss\.?\s*het|\d+(?:\.\d+)?\s*%\s*het|het)\s+(.+)$/i);
  if (het) return { kind: 'het', rest: het[1].trim() };
  const sup = raw.match(/^super\s+(.+)$/i);
  if (sup) return { kind: 'super', rest: sup[1].trim() };
  return { kind: 'none', rest: raw.trim() };
}

function unknown(raw: string): ResolvedMorph {
  return {
    resolution: { input: raw, resolved: false, message: `Unknown morph "${raw.trim()}"` },
    contributions: [],
  };
}

function ambiguous(raw: string, candidates: AlleleCandidate[]): ResolvedMorph {
  const list = candidates.map((c) => `${c.alleleName} (${c.locusId})`).join(', ');
  return {
    resolution: {
      input: raw,
      resolved: false,
      message: `"${raw.trim()}" is ambiguous — matches ${list}; specify the locus explicitly`,
    },
    contributions: [],
  };
}

function single(
  raw: string,
  locusId: string,
  pair: [string, string],
  message?: string,
): ResolvedMorph {
  return {
    resolution: { input: raw, locusId, alleles: pair, resolved: true, message },
    contributions: [{ locusId, pair }],
  };
}

function resolveMorph(raw: string, index: NameIndex): ResolvedMorph {
  const { kind, rest } = parsePrefix(raw);

  // 1. Prefix parsing first: Het/Super wrap a bare allele name.
  if (kind === 'het' || kind === 'super') {
    const candidates = index.alleles.get(rest.toLowerCase());
    if (!candidates || candidates.length === 0) return unknown(raw);
    if (candidates.length > 1) return ambiguous(raw, candidates);
    const c = candidates[0];
    if (kind === 'het') return single(raw, c.locusId, [c.alleleId, 'normal']);
    const message =
      c.inheritance === 'recessive'
        ? `"${raw.trim()}" — "Super" is not a standard form for the recessive trait ${c.alleleName}; treating as homozygous`
        : undefined;
    return single(raw, c.locusId, [c.alleleId, c.alleleId], message);
  }

  // 2. Registered combo names expand to their full requiredGenotype.
  const combo = index.combos.get(rest.toLowerCase());
  if (combo) {
    const contributions = Object.entries(combo.requiredGenotype).map(
      ([locusId, pair]): Contribution => ({ locusId, pair: [pair[0], pair[1]] }),
    );
    return { resolution: { input: raw, resolved: true }, contributions };
  }

  // 3. Bare allele name, resolved by its locus's inheritance pattern.
  const candidates = index.alleles.get(rest.toLowerCase());
  if (!candidates || candidates.length === 0) return unknown(raw);
  if (candidates.length > 1) return ambiguous(raw, candidates);
  const c = candidates[0];
  switch (c.inheritance) {
    case 'recessive':
      // Visual only when homozygous; a bare recessive name implies the visual.
      return single(raw, c.locusId, [c.alleleId, c.alleleId]);
    case 'incomplete_dominant':
      // The het is the base visual; the distinct Super form needs the prefix.
      return single(raw, c.locusId, [c.alleleId, 'normal']);
    case 'polygenic':
      // Standard-mode heuristic treats the causal locus as recessive-like.
      return single(raw, c.locusId, [c.alleleId, c.alleleId]);
    case 'dominant':
      // The homozygous "Super" form is indistinguishable by name — default to het.
      return single(
        raw,
        c.locusId,
        [c.alleleId, 'normal'],
        `${c.alleleName} is dominant; its homozygous "Super" form cannot be inferred from the name — defaulting to heterozygous`,
      );
    default:
      return single(raw, c.locusId, [c.alleleId, 'normal']);
  }
}

// ---------------------------------------------------------------------------
// Per-animal assembly (locus merging)
// ---------------------------------------------------------------------------

function resolveAnimal(
  animal: SimpleAnimalInput,
  parent: 'sire' | 'dam',
  index: NameIndex,
): { input: AnimalInput; warnings: MorphResolution[] } {
  const warnings: MorphResolution[] = [];
  // Per locus: the non-normal alleles accumulated from every morph that landed
  // here, capped at 2. Two single-allele morphs (Yellowbelly + Asphalt) merge
  // into one [yellowbelly, asphalt] locus; a third allele is an error.
  const byLocus = new Map<string, string[]>();

  for (const morph of animal.morphs) {
    const { resolution, contributions } = resolveMorph(morph, index);
    let overflowed = false;

    for (const { locusId, pair } of contributions) {
      const mutants = pair.filter((a) => a !== 'normal');
      const acc = byLocus.get(locusId) ?? [];
      if (acc.length + mutants.length > 2) {
        overflowed = true;
        continue;
      }
      acc.push(...mutants);
      byLocus.set(locusId, acc);
    }

    warnings.push(
      overflowed
        ? {
            input: morph,
            parent,
            resolved: false,
            message: `"${morph.trim()}" overflows a locus — more than two alleles would land on the same gene; excluded`,
          }
        : { ...resolution, parent },
    );
  }

  const genotype: LocusInput[] = [];
  for (const [locusId, mutants] of byLocus) {
    if (mutants.length >= 2) genotype.push({ locusId, alleles: [mutants[0], mutants[1]] });
    else if (mutants.length === 1) genotype.push({ locusId, alleles: [mutants[0], 'normal'] });
  }

  return {
    input: {
      id: animal.id,
      sex: animal.sex,
      genotype,
      polygenics: animal.polygenics ? [...animal.polygenics] : [],
    },
    warnings,
  };
}
