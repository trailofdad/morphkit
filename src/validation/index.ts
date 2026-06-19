import {
  AnimalInput,
  AnimalSex,
  CalculationMode,
  LocusInput,
  MorphkitCalculationInput,
  MorphkitDictionary,
  NormalizedAnimal,
  NormalizedBreedingPair,
  NormalizedLocus,
  InvalidGenotypeError,
  SchemaValidationError,
} from '../types';

/**
 * MK-1: Validates and normalizes a raw MorphkitCalculationInput.
 *
 * Responsibilities:
 *  - Enforce sex presence on both animals (REQ-1.2)
 *  - Default calculationMode to "standard" (REQ-1.3)
 *  - Reject loci with > 2 alleles (REQ-1.4)
 *  - Expand single-allele loci to [allele, "Normal"] (REQ-1.5)
 *  - Inject ["Normal", "Normal"] for loci missing from either animal (REQ-1.6)
 *
 * When a `dictionary` is supplied (the pipeline always passes it), MK-1 also
 * becomes dictionary-aware: it resolves community synonyms to their canonical
 * allele id (REQ-7) and rejects unknown loci / alleles (REQ-9). Called without a
 * dictionary, MK-1 stays purely structural — the engine/aggregator unit tests
 * rely on this dictionary-free mode.
 */
export function normalizeInput(
  input: MorphkitCalculationInput,
  dictionary?: MorphkitDictionary,
): NormalizedBreedingPair {
  const resolver = dictionary ? buildAlleleResolver(dictionary) : undefined;
  const sire = normalizeAnimal(input.sire, 'sire', resolver);
  const dam = normalizeAnimal(input.dam, 'dam', resolver);
  const { sire: symmetricSire, dam: symmetricDam } = ensureLocusSymmetry(sire, dam);
  const calculationMode: CalculationMode = input.calculationMode ?? 'standard';

  return { calculationMode, sire: symmetricSire, dam: symmetricDam };
}

// ---------------------------------------------------------------------------
// Dictionary-aware allele resolution (REQ-7 aliases, REQ-9 validation)
// ---------------------------------------------------------------------------

interface AlleleResolver {
  hasLocus(locusId: string): boolean;
  /** Canonical allele id for a raw input string, or undefined if unrecognized. */
  resolveAllele(locusId: string, raw: string): string | undefined;
}

/**
 * Indexes the dictionary once so MK-1 can map any of an allele's accepted spellings
 * — its id, its display name, or any registered `alias` — to the canonical id. A
 * synthetic `normal` allele is always resolvable (every locus implicitly has it,
 * and locus symmetry injects it). All keys are lowercased for case-insensitivity.
 */
function buildAlleleResolver(dictionary: MorphkitDictionary): AlleleResolver {
  const locusMaps = new Map<string, Map<string, string>>();

  for (const [locusId, locus] of Object.entries(dictionary.loci)) {
    const aliasToCanonical = new Map<string, string>();
    for (const [alleleId, allele] of Object.entries(locus.alleles)) {
      aliasToCanonical.set(alleleId.toLowerCase(), alleleId);
      if (allele.name) aliasToCanonical.set(allele.name.toLowerCase(), alleleId);
      for (const alias of allele.aliases ?? []) {
        aliasToCanonical.set(alias.toLowerCase(), alleleId);
      }
    }
    aliasToCanonical.set('normal', 'normal');
    locusMaps.set(locusId.toLowerCase(), aliasToCanonical);
  }

  return {
    hasLocus: (locusId) => locusMaps.has(locusId.toLowerCase()),
    resolveAllele: (locusId, raw) => locusMaps.get(locusId.toLowerCase())?.get(raw.toLowerCase()),
  };
}

function requireSex(animal: AnimalInput, role: string): AnimalSex {
  if (animal.sex !== 'male' && animal.sex !== 'female') {
    throw new SchemaValidationError(`${role}.sex must be "male" or "female"`, `${role}.sex`);
  }
  return animal.sex;
}

function normalizeAnimal(
  animal: AnimalInput,
  role: string,
  resolver?: AlleleResolver,
): NormalizedAnimal {
  const sex = requireSex(animal, role);
  const genotype = animal.genotype.map((locus, i) =>
    normalizeLocus(locus, `${role}.genotype[${i}]`, resolver),
  );
  return { id: animal.id, sex, genotype, polygenics: [...animal.polygenics] };
}

function normalizeLocus(
  locus: LocusInput,
  path: string,
  resolver?: AlleleResolver,
): NormalizedLocus {
  if (locus.alleles.length > 2) {
    throw new InvalidGenotypeError(
      `Locus at ${path} has ${locus.alleles.length} alleles; maximum is 2`,
      locus.locusId.toLowerCase(),
    );
  }
  if (locus.alleles.length === 0) {
    throw new SchemaValidationError(`Locus at ${path} has no alleles; minimum is 1`, path);
  }

  const locusId = locus.locusId.toLowerCase();
  if (resolver && !resolver.hasLocus(locusId)) {
    throw new SchemaValidationError(
      `Unknown locus "${locusId}" at ${path} — not present in the dictionary`,
      locusId,
    );
  }

  const resolve = (raw: string): string => {
    const lowered = raw.toLowerCase();
    if (!resolver) return lowered;
    const canonical = resolver.resolveAllele(locusId, lowered);
    if (canonical === undefined) {
      throw new InvalidGenotypeError(
        `Unknown allele "${lowered}" for locus "${locusId}" at ${path}`,
        locusId,
      );
    }
    return canonical;
  };

  const alleles: [string, string] =
    locus.alleles.length === 2
      ? [resolve(locus.alleles[0]), resolve(locus.alleles[1])]
      : [resolve(locus.alleles[0]), 'normal'];

  const sexChromosomes = normalizeSexChromosomes(locus, path);
  return sexChromosomes ? { locusId, alleles, sexChromosomes } : { locusId, alleles };
}

/**
 * Aligns an input locus's `sexChromosomes` to the normalized 2-allele form. A
 * single-allele input expanded with `normal` puts the injected `normal` on the
 * opposite chromosome from the one provided. Returns undefined when the input
 * carries no sex-chromosome annotation (the autosomal / female case).
 */
function normalizeSexChromosomes(
  locus: LocusInput,
  path: string,
): ['X' | 'Y', 'X' | 'Y'] | undefined {
  const raw = locus.sexChromosomes;
  if (!raw || raw.length === 0) return undefined;

  const upper = raw.map((c) => String(c).toUpperCase());
  for (const c of upper) {
    if (c !== 'X' && c !== 'Y') {
      throw new SchemaValidationError(`sexChromosomes at ${path} must each be "X" or "Y"`, path);
    }
  }

  if (upper.length === 2) return [upper[0] as 'X' | 'Y', upper[1] as 'X' | 'Y'];
  if (upper.length === 1) {
    const provided = upper[0] as 'X' | 'Y';
    return [provided, provided === 'X' ? 'Y' : 'X'];
  }
  throw new SchemaValidationError(`sexChromosomes at ${path} must have one entry per allele`, path);
}

function ensureLocusSymmetry(
  sire: NormalizedAnimal,
  dam: NormalizedAnimal,
): { sire: NormalizedAnimal; dam: NormalizedAnimal } {
  const sireIds = new Set(sire.genotype.map((l) => l.locusId));
  const damIds = new Set(dam.genotype.map((l) => l.locusId));
  const placeholder: [string, string] = ['normal', 'normal'];

  const sireExtra = [...damIds]
    .filter((id) => !sireIds.has(id))
    .map((locusId): NormalizedLocus => ({ locusId, alleles: placeholder }));

  const damExtra = [...sireIds]
    .filter((id) => !damIds.has(id))
    .map((locusId): NormalizedLocus => ({ locusId, alleles: placeholder }));

  return {
    sire: { ...sire, genotype: [...sire.genotype, ...sireExtra] },
    dam: { ...dam, genotype: [...dam.genotype, ...damExtra] },
  };
}
