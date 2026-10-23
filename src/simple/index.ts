import {
  AnimalInput,
  LocusInput,
  MorphkitCalculationInput,
  MorphkitDictionary,
  MorphResolution,
  SimpleAnimalInput,
  SimpleCalculationInput,
  SimpleResolution,
} from '../types';
import { AlleleIndexEntry, DictionaryIndex, createDictionaryIndex } from '../dictionary';

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
  const index = createDictionaryIndex(dictionary);
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
// Per-morph resolution
//
// Name/alias/combo resolution is delegated to the shared DictionaryIndex
// (src/dictionary) so the simple tier and any external consumer resolve names
// through one code path.
// ---------------------------------------------------------------------------

/**
 * A morph's desugared genotype contribution: a [a, b] pair on a single locus.
 * `posHet` marks an unproven carrier ("Poss Het X", "66% Het X"), which lands
 * on the genotype as `zygosity: 'pos_het'`.
 */
interface Contribution {
  readonly locusId: string;
  readonly pair: [string, string];
  readonly posHet?: { readonly carrierProbability?: number };
}

interface ResolvedMorph {
  /** Per-morph result (parent is attached by the caller). */
  readonly resolution: Omit<MorphResolution, 'parent'>;
  readonly contributions: Contribution[];
}

type ParsedPrefix =
  | { kind: 'het' | 'super' | 'none'; rest: string }
  | { kind: 'pos_het'; rest: string; carrierProbability?: number };

/** "66" → 0.66. A percentage outside (0, 100] carries no usable probability. */
function percentToProbability(pct: string): number | undefined {
  const p = Number(pct) / 100;
  return p > 0 && p <= 1 ? p : undefined;
}

function parsePrefix(raw: string): ParsedPrefix {
  // "Het X" → het. "Possible / Poss / Pos Het X" and "NN% Het X" → pos_het (an
  // unproven carrier); the NN% is its carrier probability, and "100% Het X" is
  // simply a proven het. "Super X" → super.
  const pct = raw.match(/^(\d+(?:\.\d+)?)\s*%\s*het\s+(.+)$/i);
  if (pct) {
    const carrierProbability = percentToProbability(pct[1]);
    if (carrierProbability === 1) return { kind: 'het', rest: pct[2].trim() };
    return { kind: 'pos_het', rest: pct[2].trim(), carrierProbability };
  }
  const pos = raw.match(/^(?:possible|poss\.?|pos\.?)\s*het\s+(.+)$/i);
  if (pos) return { kind: 'pos_het', rest: pos[1].trim() };
  const het = raw.match(/^het\s+(.+)$/i);
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

function ambiguous(raw: string, candidates: readonly AlleleIndexEntry[]): ResolvedMorph {
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
  posHet?: Contribution['posHet'],
): ResolvedMorph {
  return {
    resolution: { input: raw, locusId, alleles: pair, resolved: true, message },
    contributions: [{ locusId, pair, ...(posHet ? { posHet } : {}) }],
  };
}

function resolveMorph(raw: string, index: DictionaryIndex): ResolvedMorph {
  const prefix = parsePrefix(raw);
  const { kind, rest } = prefix;

  // 1. Prefix parsing first: Het/Poss Het/Super wrap a bare allele name.
  if (kind === 'het' || kind === 'pos_het' || kind === 'super') {
    const candidates = index.resolveName(rest);
    if (candidates.length === 0) return unknown(raw);
    if (candidates.length > 1) return ambiguous(raw, candidates);
    const c = candidates[0];
    if (kind === 'het') return single(raw, c.locusId, [c.alleleId, 'normal']);
    if (prefix.kind === 'pos_het') {
      const posHet =
        prefix.carrierProbability === undefined
          ? {}
          : { carrierProbability: prefix.carrierProbability };
      return single(raw, c.locusId, [c.alleleId, 'normal'], undefined, posHet);
    }
    const message =
      c.inheritance === 'recessive'
        ? `"${raw.trim()}" — "Super" is not a standard form for the recessive trait ${c.alleleName}; treating as homozygous`
        : undefined;
    return single(raw, c.locusId, [c.alleleId, c.alleleId], message);
  }

  // 2. Registered combo names expand to their full requiredGenotype.
  const combo = index.resolveCombo(rest);
  if (combo) {
    const contributions = Object.entries(combo.requiredGenotype).map(
      ([locusId, pair]): Contribution => ({ locusId, pair: [pair[0], pair[1]] }),
    );
    return { resolution: { input: raw, resolved: true }, contributions };
  }

  // 3. Bare allele name, resolved by its locus's inheritance pattern.
  const candidates = index.resolveName(rest);
  if (candidates.length === 0) return unknown(raw);
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

/**
 * Merges an already-tokenized list of morph strings into a genotype. Each morph
 * is resolved to its locus contributions, then contributions are accumulated per
 * locus (capped at 2 alleles). Shared by the string-list tier (`resolveAnimal`)
 * and the free-text tier (`resolveMorphString`).
 */
function mergeMorphs(
  morphs: readonly string[],
  parent: 'sire' | 'dam',
  index: DictionaryIndex,
): { genotype: LocusInput[]; warnings: MorphResolution[] } {
  const warnings: MorphResolution[] = [];
  // Per locus: the non-normal alleles accumulated from every morph that landed
  // here, capped at 2. Two single-allele morphs (Yellowbelly + Asphalt) merge
  // into one [yellowbelly, asphalt] locus; a third allele is an error. A
  // possible het (`posHet`) must be the locus's only allele — `pos_het` is a
  // single-mutant state — so it is excluded when anything else shares its locus.
  const byLocus = new Map<
    string,
    { mutants: string[]; posHet?: Contribution['posHet'] & { warningIndex: number } }
  >();

  const excluded = (morph: string, message: string): MorphResolution => ({
    input: morph,
    parent,
    resolved: false,
    message,
  });
  const posHetConflict = (morph: string): string =>
    `"${morph.trim()}" is a possible het on a gene that already carries another allele — a possible het must be the gene's only allele; excluded`;

  for (const morph of morphs) {
    const { resolution, contributions } = resolveMorph(morph, index);
    let failure: string | undefined;

    for (const { locusId, pair, posHet } of contributions) {
      const mutants = pair.filter((a) => a !== 'normal');
      const acc = byLocus.get(locusId) ?? { mutants: [] };
      if (posHet && acc.mutants.length > 0) {
        failure = posHetConflict(morph);
        continue;
      }
      if (acc.posHet && mutants.length > 0) {
        // A later definite allele displaces the earlier possible het.
        const earlier = warnings[acc.posHet.warningIndex];
        warnings[acc.posHet.warningIndex] = excluded(earlier.input, posHetConflict(earlier.input));
        acc.mutants = [];
        acc.posHet = undefined;
      }
      if (acc.mutants.length + mutants.length > 2) {
        failure = `"${morph.trim()}" overflows a locus — more than two alleles would land on the same gene; excluded`;
        continue;
      }
      acc.mutants.push(...mutants);
      if (posHet) acc.posHet = { ...posHet, warningIndex: warnings.length };
      byLocus.set(locusId, acc);
    }

    warnings.push(failure ? excluded(morph, failure) : { ...resolution, parent });
  }

  const genotype: LocusInput[] = [];
  for (const [locusId, { mutants, posHet }] of byLocus) {
    if (mutants.length >= 2) genotype.push({ locusId, alleles: [mutants[0], mutants[1]] });
    else if (mutants.length === 1 && posHet) {
      genotype.push({
        locusId,
        alleles: [mutants[0], 'normal'],
        zygosity: 'pos_het',
        ...(posHet.carrierProbability === undefined
          ? {}
          : { carrierProbability: posHet.carrierProbability }),
      });
    } else if (mutants.length === 1) genotype.push({ locusId, alleles: [mutants[0], 'normal'] });
  }

  return { genotype, warnings };
}

function resolveAnimal(
  animal: SimpleAnimalInput,
  parent: 'sire' | 'dam',
  index: DictionaryIndex,
): { input: AnimalInput; warnings: MorphResolution[] } {
  const { genotype, warnings } = mergeMorphs(animal.morphs, parent, index);
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

// ---------------------------------------------------------------------------
// Free-text tier — a single string of many morphs (e.g. a marketplace listing)
//
// Where the string-list tier takes one clean morph per array entry, real-world
// exports and listings arrive as one blob: "Pastel Het Clown 66% Het Pied". This
// tier tokenizes that blob against the dictionary — greedy longest-match on
// allele/combo names, honoring Het / Dbl Het / Poss Het / NN% Het prefixes — and
// then reuses the exact same resolution/merging path as the string-list tier.
// ---------------------------------------------------------------------------

/** How many words a single morph/combo name may span for greedy matching. */
const MAX_MORPH_WORDS = 4;

/**
 * The carrier prefix currently in effect while scanning left-to-right. A
 * `poss_het` keeps the literal "NN%" it was written with, so the carrier
 * probability survives into the per-morph token.
 */
type ScanPrefix = { kind: 'visual' } | { kind: 'het' } | { kind: 'poss_het'; percent?: string };

const VISUAL: ScanPrefix = { kind: 'visual' };

/**
 * Detects a het-marker phrase starting at `words[i]` and how many words it spans.
 * Recognized (case-insensitive): "50% Het", "66% Het" / any "NN% Het",
 * "Poss Het", "Possible Het", "Pos Het", "Dbl Het", and bare "Het". Returns null
 * if none.
 */
function detectPrefix(words: string[], i: number): { prefix: ScanPrefix; consumed: number } | null {
  const w0 = (words[i] ?? '').toLowerCase();
  const w1 = (words[i + 1] ?? '').toLowerCase();
  if (/^\d+(?:\.\d+)?%$/.test(w0) && w1 === 'het') {
    return { prefix: { kind: 'poss_het', percent: w0 }, consumed: 2 };
  }
  if (['poss', 'poss.', 'pos', 'pos.', 'possible'].includes(w0) && w1 === 'het') {
    return { prefix: { kind: 'poss_het' }, consumed: 2 };
  }
  if (w0 === 'dbl' && w1 === 'het') return { prefix: { kind: 'het' }, consumed: 2 };
  if (w0 === 'het') return { prefix: { kind: 'het' }, consumed: 1 };
  return null;
}

/**
 * How far a het prefix reaches.
 * - `'persist'` (default): to every following allele until another prefix —
 *   how breeders write listings ("Dbl Het Clown Pied").
 * - `'next'`: to the single trait right after it, recognized or not — how
 *   MorphMarket writes trait lists ("clown het pied pastel" is a visual Clown,
 *   het Pied, visual Pastel).
 */
export type HetScope = 'persist' | 'next';

export interface ResolveMorphStringOptions {
  readonly hetScope?: HetScope;
}

/** Result of {@link resolveMorphString}: a genotype plus per-morph and leftover diagnostics. */
export interface MorphStringResolution {
  /** The desugared genotype (identical shape to the string-list tier's output). */
  readonly genotype: LocusInput[];
  /** The canonical per-morph tokens the string was split into (e.g. "Het Clown"). */
  readonly morphs: string[];
  /** Per-morph resolution log — inspect `resolved`/`message` for ambiguous names. */
  readonly warnings: MorphResolution[];
  /** Words that matched no known allele or combo — surface for manual review. */
  readonly unresolved: string[];
}

/**
 * Tokenizes and resolves a single free-text morph string into a genotype. A het
 * prefix (Het / Dbl Het / Poss Het / Pos Het / NN% Het) applies to the allele
 * that follows it; by default it persists to subsequent alleles until another
 * prefix appears — matching how breeders write listings ("Dbl Het Clown Pied").
 * Pass `{ hetScope: 'next' }` for sources where each prefix covers exactly one
 * trait (see {@link HetScope}). A possible-het prefix yields a `pos_het` locus,
 * with the NN% as its `carrierProbability`. A combo name only matches while no
 * het prefix is active (a "Het Freeway" is not a meaningful visual). An `" or "`
 * anywhere makes the string too ambiguous to map, and the whole thing is
 * returned as `unresolved`. The output feeds the same pipeline as every other
 * tier via {@link resolveSimpleInput} or {@link mergeMorphs}.
 */
export function resolveMorphString(
  raw: string,
  dictionary: MorphkitDictionary,
  parent: 'sire' | 'dam' = 'sire',
  options: ResolveMorphStringOptions = {},
): MorphStringResolution {
  const hetScope = options.hetScope ?? 'persist';
  const index = createDictionaryIndex(dictionary);
  const trimmed = raw.trim();
  if (!trimmed) return { genotype: [], morphs: [], warnings: [], unresolved: [] };

  // "Asphalt or Yellowbelly" — a genuine either/or the caller must disambiguate.
  if (/\bor\b/i.test(trimmed)) {
    return { genotype: [], morphs: [], warnings: [], unresolved: [trimmed] };
  }

  const words = trimmed.split(/\s+/);
  const morphs: string[] = [];
  const unresolved: string[] = [];
  let prefix: ScanPrefix = VISUAL;
  let i = 0;
  // Under `hetScope: 'next'` a prefix is spent on the trait after it, whether
  // that trait resolves or not — so an unknown trait can't pass its "het" on.
  const spendPrefix = (): void => {
    if (hetScope === 'next') prefix = VISUAL;
  };

  const greedy = (kind: 'allele' | 'combo'): { name: string; consumed: number } | null => {
    const maxLen = Math.min(words.length - i, MAX_MORPH_WORDS);
    for (let len = maxLen; len >= 1; len--) {
      const candidate = words.slice(i, i + len).join(' ');
      const hit =
        kind === 'combo' ? index.resolveCombo(candidate) : index.resolveNameUnique(candidate);
      if (hit) return { name: candidate, consumed: len };
    }
    return null;
  };

  while (i < words.length) {
    const marker = detectPrefix(words, i);
    if (marker) {
      prefix = marker.prefix;
      i += marker.consumed;
      continue;
    }

    // Combos are multi-locus visuals — only meaningful with no active het prefix.
    if (prefix.kind === 'visual') {
      const combo = greedy('combo');
      if (combo) {
        morphs.push(combo.name);
        i += combo.consumed;
        continue;
      }
    }

    const allele = greedy('allele');
    if (allele) {
      const token =
        prefix.kind === 'het'
          ? `Het ${allele.name}`
          : prefix.kind === 'poss_het'
            ? `${prefix.percent ?? 'Poss'} Het ${allele.name}`
            : allele.name;
      morphs.push(token);
      i += allele.consumed;
      spendPrefix();
      continue;
    }

    unresolved.push(words[i]);
    i++;
    spendPrefix();
  }

  const { genotype, warnings } = mergeMorphs(morphs, parent, index);
  return { genotype, morphs, warnings, unresolved };
}
