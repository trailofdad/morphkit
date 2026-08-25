import { ComboDefinition, InheritanceType, MorphkitDictionary } from '../types';

// =============================================================================
// Dictionary Index (public utility)
//
// A prebuilt, O(1) lookup over a MorphkitDictionary. Every consumer that needs
// to turn a human morph string into a locus/allele identity — or to answer
// "what is this locus's inheritance pattern?" — was re-deriving these maps by
// hand (and often scanning the whole dictionary per lookup). This centralizes
// that indexing so callers can resolve names, aliases, shortNames, and raw ids
// case-insensitively, detect ambiguity, and read locus metadata without walking
// `dictionary.loci` themselves.
//
// The simple tier (src/simple) and MK-1 validation resolve names internally for
// their own narrower purposes; this module is the sharable, exported form.
// =============================================================================

/** One resolved allele candidate: the locus/allele identity plus locus metadata. */
export interface AlleleIndexEntry {
  readonly locusId: string;
  readonly alleleId: string;
  /** The allele's canonical display name (falls back to the allele id). */
  readonly alleleName: string;
  readonly inheritance: InheritanceType;
  readonly isSexLinked: boolean;
}

/** An O(1) lookup over a dictionary's names, aliases, shortNames, and combos. */
export interface DictionaryIndex {
  /**
   * Every allele matching `raw` (its id, display name, alias, or shortName),
   * case-insensitively. A length > 1 means the name is ambiguous — it resolves
   * to more than one locus (e.g. a spelling registered as an alias of one locus
   * and the canonical name of another). Empty when unknown.
   */
  resolveName(raw: string): readonly AlleleIndexEntry[];
  /** The single allele `raw` resolves to, or undefined if unknown or ambiguous. */
  resolveNameUnique(raw: string): AlleleIndexEntry | undefined;
  /** A registered combo matching `raw` (marketName, alias, or shortName). */
  resolveCombo(raw: string): ComboDefinition | undefined;
  /** A locus's inheritance pattern by its locus id, or undefined if unknown. */
  getInheritance(locusId: string): InheritanceType | undefined;
  /** A locus's display name by its locus id, or undefined if unknown. */
  getLocusName(locusId: string): string | undefined;
  /** An allele's display name by locus + allele id, or undefined if unknown. */
  getAlleleName(locusId: string, alleleId: string): string | undefined;
}

/**
 * Builds a {@link DictionaryIndex} from a dictionary. Do this once and reuse the
 * result across many lookups; the returned accessors are all O(1). Keys are
 * lowercased so lookups are case-insensitive — pass the raw user string, no
 * pre-normalization needed.
 */
export function createDictionaryIndex(dictionary: MorphkitDictionary): DictionaryIndex {
  const alleles = new Map<string, AlleleIndexEntry[]>();
  const combos = new Map<string, ComboDefinition>();

  const addAllele = (key: string, entry: AlleleIndexEntry): void => {
    const k = key.toLowerCase().trim();
    if (!k) return;
    const list = alleles.get(k) ?? [];
    if (!list.some((c) => c.locusId === entry.locusId && c.alleleId === entry.alleleId)) {
      list.push(entry);
    }
    alleles.set(k, list);
  };

  for (const [locusId, locus] of Object.entries(dictionary.loci)) {
    for (const [alleleId, allele] of Object.entries(locus.alleles)) {
      if (alleleId === 'normal') continue;
      const entry: AlleleIndexEntry = {
        locusId,
        alleleId,
        alleleName: allele.name ?? alleleId,
        inheritance: locus.inheritance,
        isSexLinked: locus.isSexLinked,
      };
      addAllele(alleleId, entry);
      if (allele.name) addAllele(allele.name, entry);
      for (const alias of allele.aliases ?? []) addAllele(alias, entry);
      for (const short of allele.shortNames ?? []) addAllele(short, entry);
    }
  }

  const addCombo = (key: string, combo: ComboDefinition): void => {
    const k = key.toLowerCase().trim();
    // First registration wins, mirroring the simple tier's combo index.
    if (k && !combos.has(k)) combos.set(k, combo);
  };
  for (const combo of dictionary.combos) {
    addCombo(combo.marketName, combo);
    for (const alias of combo.aliases ?? []) addCombo(alias, combo);
    for (const short of combo.shortNames ?? []) addCombo(short, combo);
  }

  return {
    resolveName: (raw) => alleles.get(raw.toLowerCase().trim()) ?? [],
    resolveNameUnique: (raw) => {
      const list = alleles.get(raw.toLowerCase().trim());
      return list && list.length === 1 ? list[0] : undefined;
    },
    resolveCombo: (raw) => combos.get(raw.toLowerCase().trim()),
    getInheritance: (locusId) => dictionary.loci[locusId]?.inheritance,
    getLocusName: (locusId) => dictionary.loci[locusId]?.name,
    getAlleleName: (locusId, alleleId) =>
      dictionary.loci[locusId]?.alleles[alleleId]?.name,
  };
}
