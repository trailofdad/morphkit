/** Inheritance pattern for a locus — used by MK-2 via CDN Dictionary lookup. */
export type InheritancePattern = 'recessive' | 'dominant' | 'co-dominant' | 'sex-linked';
/** The sex of an animal, used for sex-linked locus calculations. */
export type AnimalSex = 'male' | 'female';
/** Determines how polygenic traits are expanded (standard vs. diagnostic mode). */
export type CalculationMode = 'standard' | 'diagnostic';
/** One entry in the CDN Dictionary, keyed by locusId. */
export interface LocusDictionaryEntry {
    readonly locusId: string;
    readonly inheritancePattern: InheritancePattern;
}
/** The full CDN Dictionary payload the main thread fetches and forwards. */
export type CdnDictionary = readonly LocusDictionaryEntry[];
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
/**
 * A fully normalized locus: exactly 2 alleles, never implicit.
 * The engine (MK-2) only ever receives this form. inheritancePattern is
 * resolved by MK-2 via CDN Dictionary lookup, not by MK-1.
 */
export interface NormalizedLocus {
    readonly locusId: string;
    /** Exactly 2 alleles — e.g., ["Clown", "Normal"] or ["Clown", "Clown"]. */
    readonly alleles: [string, string];
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
    readonly probability: number;
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
/** Thrown when the raw input payload fails schema validation (MK-1). */
export declare class SchemaValidationError extends Error {
    readonly field?: string | undefined;
    constructor(message: string, field?: string | undefined);
}
/** Thrown when a locus array has an invalid number of alleles (MK-1 / MK-2). */
export declare class InvalidGenotypeError extends Error {
    readonly locusId?: string | undefined;
    constructor(message: string, locusId?: string | undefined);
}
/**
 * Thrown when the sum of all outcome probabilities in a Punnett matrix
 * does not equal exactly 1.0, violating Hardy-Weinberg equilibrium (MK-2).
 */
export declare class CartesianMatrixError extends Error {
    readonly actualSum?: number | undefined;
    constructor(message: string, actualSum?: number | undefined);
}
export type InheritanceType = "recessive" | "dominant" | "incomplete_dominant" | "polygenic";
export interface AlleleDefinition {
    id: string;
    name: string;
    defects?: string[];
}
export interface LocusDefinition {
    id: string;
    name: string;
    inheritance: InheritanceType;
    isSexLinked: boolean;
    alleles: Record<string, AlleleDefinition>;
}
export interface ComboDefinition {
    marketName: string;
    requiredGenotype: Record<string, [string, string]>;
}
export interface LethalComboDefinition {
    triggerGenotype: Record<string, [string, string]>;
}
export interface MorphkitDictionary {
    version: string;
    lastUpdated: string;
    loci: Record<string, LocusDefinition>;
    combos: ComboDefinition[];
    lethalCombos: LethalComboDefinition[];
    polygenicTags: string[];
}
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
/**
 * Thrown by syncDictionary when the CDN fetch fails and no local cache exists
 * to fall back to (cold-start offline scenario).
 */
export declare class DictionaryNetworkError extends Error {
    readonly cause?: unknown | undefined;
    constructor(message: string, cause?: unknown | undefined);
}
//# sourceMappingURL=types.d.ts.map