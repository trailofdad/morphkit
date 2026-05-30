"use strict";
// =============================================================================
// Morphkit Core Type Definitions
// MK-0: Base Types & Interfaces
// =============================================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.DictionaryNetworkError = exports.CartesianMatrixError = exports.InvalidGenotypeError = exports.SchemaValidationError = void 0;
// ---------------------------------------------------------------------------
// Error Types
// ---------------------------------------------------------------------------
/** Thrown when the raw input payload fails schema validation (MK-1). */
class SchemaValidationError extends Error {
    field;
    constructor(message, field) {
        super(message);
        this.field = field;
        this.name = 'SchemaValidationError';
    }
}
exports.SchemaValidationError = SchemaValidationError;
/** Thrown when a locus array has an invalid number of alleles (MK-1 / MK-2). */
class InvalidGenotypeError extends Error {
    locusId;
    constructor(message, locusId) {
        super(message);
        this.locusId = locusId;
        this.name = 'InvalidGenotypeError';
    }
}
exports.InvalidGenotypeError = InvalidGenotypeError;
/**
 * Thrown when the sum of all outcome probabilities in a Punnett matrix
 * does not equal exactly 1.0, violating Hardy-Weinberg equilibrium (MK-2).
 */
class CartesianMatrixError extends Error {
    actualSum;
    constructor(message, actualSum) {
        super(message);
        this.actualSum = actualSum;
        this.name = 'CartesianMatrixError';
    }
}
exports.CartesianMatrixError = CartesianMatrixError;
// ---------------------------------------------------------------------------
// Network Error Types (MK-6)
// ---------------------------------------------------------------------------
/**
 * Thrown by syncDictionary when the CDN fetch fails and no local cache exists
 * to fall back to (cold-start offline scenario).
 */
class DictionaryNetworkError extends Error {
    cause;
    constructor(message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'DictionaryNetworkError';
    }
}
exports.DictionaryNetworkError = DictionaryNetworkError;
//# sourceMappingURL=types.js.map