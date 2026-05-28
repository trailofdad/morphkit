// =============================================================================
// Morphkit Core Type Definitions
// MK-0: Base Types & Interfaces
// =============================================================================

// ---------------------------------------------------------------------------
// Enums & Literal Types
// ---------------------------------------------------------------------------

/** Inheritance pattern for a locus. */
export type InheritancePattern =
  | 'recessive'
  | 'dominant'
  | 'co-dominant'
  | 'sex-linked';

/** The sex of an animal, used for sex-linked locus calculations. */
export type AnimalSex = 'male' | 'female';

// ---------------------------------------------------------------------------
// Input Payload — what the caller sends to the engine
// ---------------------------------------------------------------------------

/**
 * Represents one locus on an animal, as provided by the caller.
 * An implicit input may omit the second allele (e.g., just ["Clown"]),
 * which the MK-1 Validation layer will normalize to ["Clown", "Normal"].
 */
export interface LocusInput {
  /** The name of the gene/trait (e.g., "Clown", "Spider", "Banana"). */
  readonly geneName: string;
  /** Alleles present. Must have 1 or 2 elements before normalization. */
  readonly alleles: [string] | [string, string];
  /** Inheritance pattern for this locus. */
  readonly inheritancePattern: InheritancePattern;
}

/** Represents one animal in the breeding pair as provided by the caller. */
export interface AnimalInput {
  /** Optional display label for the animal. */
  readonly label?: string;
  /** Declared sex; required when any locus is sex-linked. */
  readonly sex?: AnimalSex;
  /** All loci expressed or carried by this animal. */
  readonly loci: readonly LocusInput[];
}

/**
 * The top-level input payload passed to the Morphkit engine.
 * AC-4: explicitly exported.
 */
export interface MorphkitCalculationInput {
  readonly sire: AnimalInput;
  readonly dam: AnimalInput;
}

// ---------------------------------------------------------------------------
// Normalized Breeding Pair — output of MK-1 Validation
// ---------------------------------------------------------------------------

/**
 * A fully normalized locus: exactly 2 alleles, never implicit.
 * The engine (MK-2) only ever receives this form.
 */
export interface NormalizedLocus {
  readonly geneName: string;
  /** Exactly 2 alleles — e.g., ["Clown", "Normal"] or ["Clown", "Clown"]. */
  readonly alleles: [string, string];
  readonly inheritancePattern: InheritancePattern;
}

/** One animal after MK-1 normalization. */
export interface NormalizedAnimal {
  readonly label?: string;
  /** Sex is always present after normalization if any sex-linked locus exists. */
  readonly sex?: AnimalSex;
  readonly loci: readonly NormalizedLocus[];
}

/**
 * The breeding pair after MK-1 normalization; this is what MK-2 receives.
 */
export interface NormalizedBreedingPair {
  readonly sire: NormalizedAnimal;
  readonly dam: NormalizedAnimal;
}

// ---------------------------------------------------------------------------
// Engine Outcomes — output of MK-2 Cartesian Punnett Matrix
// ---------------------------------------------------------------------------

/**
 * The raw genotype for a single offspring produced by the Punnett matrix.
 * One entry exists per unique allele combination across all loci.
 */
export interface GenotypeOutcome {
  /** The loci that define this genotype, each with exactly 2 alleles. */
  readonly loci: readonly NormalizedLocus[];
  /** Fractional probability, e.g. 0.25. All outcomes in a result sum to 1.0. */
  readonly decimalProbability: number;
  /** The sex of this offspring, if determinable (sex-linked calculations). */
  readonly sex?: AnimalSex;
}

// ---------------------------------------------------------------------------
// Aggregator Output — output of MK-3 & MK-4
// ---------------------------------------------------------------------------

/**
 * A human-readable phenotype name resolved from a genotype.
 * e.g., "Freeway", "Puma", "Normal", "Pastel Het Clown"
 */
export type PhenotypeName = string;

/**
 * A "possible het" marker, e.g. "66% Possible Het Clown".
 */
export interface PossibleHet {
  readonly geneName: string;
  readonly probability: number; // 0–1
}

/**
 * A single offspring outcome after full aggregation (phenotype + warnings).
 */
export interface AggregatedOutcome {
  /** The underlying raw genotype from MK-2. */
  readonly genotype: GenotypeOutcome;
  /** The resolved visual phenotype name(s), e.g. ["Pastel", "Clown"]. */
  readonly phenotypeNames: readonly PhenotypeName[];
  /** The combined combo name if one is registered, e.g. "Freeway". */
  readonly comboName?: PhenotypeName;
  /** Fractional probability, mirrored from the genotype for convenience. */
  readonly decimalProbability: number;
  /** Percentage string, e.g. "25%". */
  readonly percentageProbability: string;
  /** Possible-het markers for recessive alleles the animal carries but doesn't express. */
  readonly possibleHets: readonly PossibleHet[];
  /** True if this genotype is embryonically lethal (e.g., Homozygous Spider). */
  readonly isLethal: boolean;
  /** Congenital or neurological warnings even if the animal is visually masked. */
  readonly congenitalWarnings: readonly string[];
  /** Sex of this offspring, if known. */
  readonly sex?: AnimalSex;
}

/**
 * The final output of the Morphkit engine.
 * AC-4: explicitly exported.
 */
export interface MorphkitCalculationOutput {
  /** All possible offspring outcomes, sorted by descending probability. */
  readonly outcomes: readonly AggregatedOutcome[];
  /** The input pair that produced these results, after normalization. */
  readonly normalizedInput: NormalizedBreedingPair;
  /** ISO timestamp of when this calculation was performed. */
  readonly calculatedAt: string;
}

// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------

/** Thrown when the raw input payload fails schema validation (MK-1). */
export class SchemaValidationError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'SchemaValidationError';
  }
}

/** Thrown when a locus array has more than 2 alleles (MK-1 / MK-2). */
export class InvalidGenotypeError extends Error {
  constructor(
    message: string,
    public readonly geneName?: string,
  ) {
    super(message);
    this.name = 'InvalidGenotypeError';
  }
}

/**
 * Thrown when the sum of all outcome probabilities in a Punnett matrix
 * does not equal exactly 1.0, violating Hardy-Weinberg equilibrium (MK-2).
 */
export class CartesianMatrixError extends Error {
  constructor(
    message: string,
    public readonly actualSum?: number,
  ) {
    super(message);
    this.name = 'CartesianMatrixError';
  }
}
