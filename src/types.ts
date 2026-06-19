// =============================================================================
// Morphkit Core Type Definitions
// MK-0: Base Types & Interfaces
// =============================================================================

// ---------------------------------------------------------------------------
// Enums & Literal Types
// ---------------------------------------------------------------------------

/** Inheritance pattern for a locus — used by MK-2 via CDN Dictionary lookup. */
export type InheritancePattern = 'recessive' | 'dominant' | 'co-dominant' | 'sex-linked';

/** The sex of an animal, used for sex-linked locus calculations. */
export type AnimalSex = 'male' | 'female';

/** Determines how polygenic traits are expanded (standard vs. diagnostic mode). */
export type CalculationMode = 'standard' | 'diagnostic';

// ---------------------------------------------------------------------------
// CDN Dictionary — passed to the worker by the main thread (MK-5),
// then forwarded into the engine so MK-2 can resolve inheritance patterns.
// ---------------------------------------------------------------------------

/** One entry in the CDN Dictionary, keyed by locusId. */
export interface LocusDictionaryEntry {
  readonly locusId: string;
  readonly inheritancePattern: InheritancePattern;
}

/** The full CDN Dictionary payload the main thread fetches and forwards. */
export type CdnDictionary = readonly LocusDictionaryEntry[];

// ---------------------------------------------------------------------------
// Input Payload — what the caller sends to the engine
// ---------------------------------------------------------------------------

/**
 * Represents one locus on an animal, as provided by the caller.
 * An implicit input may omit the second allele (e.g., just ["Clown"]),
 * which the MK-1 Validation layer will normalize to ["Clown", "Normal"].
 * alleles is typed as readonly string[] to reflect raw JSON boundary reality;
 * MK-1 validates that length is 1 or 2.
 */
export interface LocusInput {
  readonly locusId: string;
  readonly alleles: readonly string[];
  /**
   * Sex-linked loci only: which sex chromosome each entry in `alleles` rides, in
   * the same order. Meaningful on the heterogametic (male) parent — e.g. alleles
   * `['banana','normal']` with `['Y','X']` is a Male-Maker (banana on the Y);
   * `['X','Y']` is a Female-Maker (banana on the X). When omitted, a male's
   * mutant allele defaults to the Y (Male-Maker). Ignored for autosomal loci and
   * for females (both alleles ride an X).
   */
  readonly sexChromosomes?: readonly ('X' | 'Y')[];
  /**
   * Carrier zygosity when the locus is stated with a single mutant allele:
   * `'het'` is a proven heterozygote (`[allele, normal]`); `'pos_het'` is a
   * possible (unproven) carrier, for which the engine produces the probabilistic
   * offspring distribution weighted by `carrierProbability`. A DNA-proven positive
   * is expressed as `'het'`; a proven negative by omitting the locus.
   */
  readonly zygosity?: 'het' | 'pos_het';
  /** Carrier probability for a `'pos_het'` locus, 0–1. Defaults to 0.5. */
  readonly carrierProbability?: number;
}

/** Represents one animal in the breeding pair as provided by the caller. */
export interface AnimalInput {
  readonly id: string;
  /** Declared sex; MK-1 throws SchemaValidationError if absent or invalid. */
  readonly sex?: AnimalSex;
  readonly genotype: readonly LocusInput[];
  readonly polygenics: readonly string[];
}

/**
 * The top-level input payload passed to the Morphkit engine.
 * AC-4: explicitly exported.
 */
export interface MorphkitCalculationInput {
  /** Defaults to "standard" if omitted. */
  readonly calculationMode?: CalculationMode;
  readonly sire: AnimalInput;
  readonly dam: AnimalInput;
}

// ---------------------------------------------------------------------------
// Simple API tier — name-resolution front-end (desugars to MorphkitCalculationInput)
// ---------------------------------------------------------------------------

/**
 * One animal in the simple tier: a flat list of morph names instead of an
 * explicit per-locus genotype. The resolver infers each name's genotype from the
 * dictionary's inheritance pattern (see `resolveSimpleInput`).
 */
export interface SimpleAnimalInput {
  readonly id: string;
  /** MK-1 still requires sex once the pipeline runs; carried through unchanged. */
  readonly sex?: AnimalSex;
  /** Flat morph names, e.g. ["Pastel", "Het Clown", "Super Cinnamon", "Freeway"]. */
  readonly morphs: readonly string[];
  readonly polygenics?: readonly string[];
}

/** Top-level simple-tier input — the name-list analogue of MorphkitCalculationInput. */
export interface SimpleCalculationInput {
  readonly calculationMode?: CalculationMode;
  readonly sire: SimpleAnimalInput;
  readonly dam: SimpleAnimalInput;
}

/**
 * The per-morph result of name resolution. A UI can surface exactly which inputs
 * were ambiguous or unresolved (`resolved: false` and/or a `message`). Resolved
 * morphs carry the `locusId` and `alleles` they desugared to (before locus
 * merging); combo names that span multiple loci omit those two fields.
 */
export interface MorphResolution {
  /** The original morph string supplied by the caller. */
  readonly input: string;
  /** Which parent the morph belonged to (warnings from both parents share one array). */
  readonly parent: 'sire' | 'dam';
  readonly locusId?: string;
  readonly alleles?: [string, string];
  readonly resolved: boolean;
  /** Present for ambiguous, unknown, or informational (dominant/super) cases. */
  readonly message?: string;
}

/** Output of `resolveSimpleInput`: a complex input plus the per-morph resolution log. */
export interface SimpleResolution {
  readonly input: MorphkitCalculationInput;
  readonly warnings: MorphResolution[];
}

// ---------------------------------------------------------------------------
// Normalized Breeding Pair — output of MK-1 Validation
// ---------------------------------------------------------------------------

/**
 * A fully normalized locus: exactly 2 alleles, never implicit.
 * The engine (MK-2) only ever receives this form. inheritancePattern is
 * resolved by MK-2 via CDN Dictionary lookup, not by MK-1.
 */
export interface NormalizedLocus {
  readonly locusId: string;
  /** Exactly 2 alleles — e.g., ["Clown", "Normal"] or ["Clown", "Clown"]. */
  readonly alleles: [string, string];
  /**
   * Sex chromosome each allele rides, same order as `alleles`. Carried from a
   * sex-linked input on the heterogametic parent; the engine uses it to route
   * the Y-borne allele to sons and the X-borne allele to daughters. Absent on
   * autosomal loci and on the homogametic (female) parent.
   */
  readonly sexChromosomes?: readonly ['X' | 'Y', 'X' | 'Y'];
  /**
   * Present when the locus came in as `'pos_het'`. The pipeline expands it into a
   * carrier (`[allele, normal]`) vs non-carrier (`[normal, normal]`) mixture
   * weighted by this probability before running the Punnett matrix.
   */
  readonly carrierProbability?: number;
}

/** One animal after MK-1 normalization. */
export interface NormalizedAnimal {
  readonly id: string;
  /** Sex is always present after MK-1 validation. */
  readonly sex: AnimalSex;
  readonly genotype: readonly NormalizedLocus[];
  readonly polygenics: readonly string[];
}

/**
 * The breeding pair after MK-1 normalization; this is what MK-2 receives.
 */
export interface NormalizedBreedingPair {
  /** Always resolved; never undefined after MK-1. */
  readonly calculationMode: CalculationMode;
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
  readonly locusId: string;
  readonly probability: number; // 0–1
  /** True when every non-visual offspring at this locus must be a carrier (probability === 1.0). */
  readonly isGuaranteed: boolean;
}

/**
 * A single offspring outcome after full aggregation (phenotype + warnings).
 */
export interface AggregatedOutcome {
  /** The underlying raw genotype from MK-2. */
  readonly genotype: GenotypeOutcome;
  /** The resolved visual phenotype name(s), e.g. ["Pastel", "Clown"]. */
  readonly phenotypeNames: readonly PhenotypeName[];
  /**
   * The market combo name when a registered ComboDefinition matches; otherwise
   * the joined phenotypeNames (e.g. "Pastel Clown"). Undefined only for
   * all-Normal outcomes.
   */
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
  /** Deduplicated polygenics from both parents, injected by MK-3. */
  readonly polygenics: readonly string[];
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

/** Thrown when a locus array has an invalid number of alleles (MK-1 / MK-2). */
export class InvalidGenotypeError extends Error {
  constructor(
    message: string,
    public readonly locusId?: string,
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

// --- DICTIONARY TYPES ---

export type InheritanceType = 'recessive' | 'dominant' | 'incomplete_dominant' | 'polygenic';

export interface AlleleDefinition {
  id: string; // e.g., "spider", "banana_malemaker"
  name: string; // e.g., "Spider", "Banana (Male Maker)"
  defects?: string[]; // fires het or homozygous, e.g. ["Neurological Wobble"]
  /** Defects that fire only in the homozygous (super) state, e.g. Super Sable wobble. */
  superDefects?: string[];
  /** Community synonyms / abbreviations for this allele, e.g. ["HGW"]. */
  aliases?: string[];
  /** Very short labels for tub tags or printing, e.g. ["Past"]. */
  shortNames?: string[];
  /**
   * IDs of other alleles at THIS SAME locus that are visually indistinguishable
   * from this one in the single-gene state (e.g. asphalt ↔ gravel ↔ yellowbelly).
   */
  indistinctFrom?: string[];
}

export interface LocusDefinition {
  id: string; // e.g., "yellowbelly_complex"
  name: string; // e.g., "Yellowbelly Complex"
  inheritance: InheritanceType;
  isSexLinked: boolean; // True for Banana/Coral Glow
  alleles: Record<string, AlleleDefinition>; // O(1) lookup map of alleles at this locus
}

export interface ComboDefinition {
  marketName: string; // e.g., "Freeway"
  /** Alternative community names for this combo. */
  aliases?: string[];
  /** Very short labels for tub tags or printing. */
  shortNames?: string[];
  // Map of locusId to required alleles.
  // e.g., { "yellowbelly_complex": ["yellowbelly", "asphalt"] }
  requiredGenotype: Record<string, [string, string]>;
}

export interface LethalComboDefinition {
  // Loci conditions that trigger embryonic lethality
  // e.g., { "spider_complex": ["spider", "spider"] }
  triggerGenotype: Record<string, [string, string]>;
}

export interface DefectComboDefinition {
  // Loci conditions that trigger a congenital defect (not lethal), e.g. "Bug Eyes"
  // from a BEL-super × Piebald, or "Duckbilling" from Super Cinnamon.
  triggerGenotype: Record<string, [string, string]>;
  defects: string[]; // e.g., ["Bug Eyes"]
}

export interface MorphkitDictionary {
  version: string;
  lastUpdated: string;
  loci: Record<string, LocusDefinition>; // O(1) Locus lookup
  combos: ComboDefinition[]; // Array of market combos to match against
  lethalCombos: LethalComboDefinition[]; // Array of unviable genetic states
  defectCombos?: DefectComboDefinition[]; // Combination-triggered congenital defects
  polygenicTags: string[]; // Valid known polygenics (e.g., "Jungle")
}

// ---------------------------------------------------------------------------
// Worker Message Protocol (MK-5)
// ---------------------------------------------------------------------------

/** Message sent from main thread → worker to trigger a calculation. */
export interface WorkerCalculateMessage {
  type: 'CALCULATE';
  input: MorphkitCalculationInput;
  dictionary: MorphkitDictionary;
}

/** Serialized error payload sent from worker → main thread on failure. */
export interface WorkerErrorPayload {
  name: string;
  message: string;
  field?: string;
  locusId?: string;
  actualSum?: number;
}

/** Success response sent from worker → main thread. */
export interface WorkerSuccessMessage {
  type: 'SUCCESS';
  output: MorphkitCalculationOutput;
}

/** Error response sent from worker → main thread. */
export interface WorkerErrorMessage {
  type: 'ERROR';
  error: WorkerErrorPayload;
}

/** Union of all messages the worker can post back to the main thread. */
export type WorkerOutboundMessage = WorkerSuccessMessage | WorkerErrorMessage;

// ---------------------------------------------------------------------------
// Network Error Types (MK-6)
// ---------------------------------------------------------------------------

/**
 * Thrown by syncDictionary when the CDN fetch fails and no local cache exists
 * to fall back to (cold-start offline scenario).
 */
export class DictionaryNetworkError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DictionaryNetworkError';
  }
}
