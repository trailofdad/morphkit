import {
  AnimalInput,
  AnimalSex,
  CalculationMode,
  LocusInput,
  MorphkitCalculationInput,
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
 */
export function normalizeInput(input: MorphkitCalculationInput): NormalizedBreedingPair {
  const sire = normalizeAnimal(input.sire, 'sire');
  const dam = normalizeAnimal(input.dam, 'dam');
  const { sire: symmetricSire, dam: symmetricDam } = ensureLocusSymmetry(sire, dam);
  const calculationMode: CalculationMode = input.calculationMode ?? 'standard';

  return { calculationMode, sire: symmetricSire, dam: symmetricDam };
}

function requireSex(animal: AnimalInput, role: string): AnimalSex {
  if (animal.sex !== 'male' && animal.sex !== 'female') {
    throw new SchemaValidationError(`${role}.sex must be "male" or "female"`, `${role}.sex`);
  }
  return animal.sex;
}

function normalizeAnimal(animal: AnimalInput, role: string): NormalizedAnimal {
  const sex = requireSex(animal, role);
  const genotype = animal.genotype.map((locus, i) =>
    normalizeLocus(locus, `${role}.genotype[${i}]`),
  );
  return { id: animal.id, sex, genotype, polygenics: [...animal.polygenics] };
}

function normalizeLocus(locus: LocusInput, path: string): NormalizedLocus {
  if (locus.alleles.length > 2) {
    throw new InvalidGenotypeError(
      `Locus at ${path} has ${locus.alleles.length} alleles; maximum is 2`,
      locus.locusId.toLowerCase(),
    );
  }
  if (locus.alleles.length === 0) {
    throw new SchemaValidationError(`Locus at ${path} has no alleles; minimum is 1`, path);
  }
  const alleles: [string, string] =
    locus.alleles.length === 2
      ? [locus.alleles[0].toLowerCase(), locus.alleles[1].toLowerCase()]
      : [locus.alleles[0].toLowerCase(), 'normal'];

  return { locusId: locus.locusId.toLowerCase(), alleles };
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
