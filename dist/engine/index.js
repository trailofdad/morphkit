"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePunnettMatrix = computePunnettMatrix;
exports.validateHardyWeinberg = validateHardyWeinberg;
const types_1 = require("../types");
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * MK-2: Executes the Cartesian Punnett Matrix over all loci in the
 * normalized breeding pair and returns deduplicated GenotypeOutcome[].
 *
 * Sex-linked loci (flagged in `dictionary`) bypass independent assortment:
 * sire alleles tagged `_MaleMaker` route exclusively to male offspring;
 * all other sire alleles on a sex-linked locus route to female offspring.
 *
 * Throws CartesianMatrixError if the sum of decimalProbability ≠ 1.0.
 */
function computePunnettMatrix(pair, dictionary) {
    // Start with a single empty partial outcome, then fold each locus in.
    let combined = [{ loci: [] }];
    for (const { locusId } of pair.sire.genotype) {
        const sireLocus = requireLocus(pair.sire.genotype, locusId);
        const damLocus = requireLocus(pair.dam.genotype, locusId);
        const matrix = buildLocusMatrix(sireLocus, damLocus, isSexLinked(locusId, dictionary));
        combined = crossProduct(combined, matrix);
    }
    const totalRaw = combined.length;
    const outcomes = deduplicate(combined, totalRaw);
    validateHardyWeinberg(outcomes);
    return outcomes;
}
/**
 * Validates Hardy-Weinberg equilibrium: the sum of all decimalProbability
 * values must equal exactly 1.0. Exported for direct unit testing (AC-3).
 */
function validateHardyWeinberg(outcomes) {
    const sum = outcomes.reduce((acc, o) => acc + o.decimalProbability, 0);
    if (sum !== 1.0) {
        throw new types_1.CartesianMatrixError(`Hardy-Weinberg violation: probability sum is ${sum}, expected 1.0`, sum);
    }
}
// ---------------------------------------------------------------------------
// Per-locus 2×2 matrix
// ---------------------------------------------------------------------------
function buildLocusMatrix(sireLocus, damLocus, sexLinked) {
    const outcomes = [];
    for (const sireAllele of sireLocus.alleles) {
        // For sex-linked loci, alleles on the sire's Y chromosome (tagged
        // _MaleMaker) route to male offspring; all others are X-linked → female.
        const sex = sexLinked
            ? sireAllele.endsWith('_malemaker')
                ? 'male'
                : 'female'
            : undefined;
        for (const damAllele of damLocus.alleles) {
            outcomes.push({
                loci: [{ locusId: sireLocus.locusId, alleles: sortPair(sireAllele, damAllele) }],
                sex,
            });
        }
    }
    return outcomes; // always 4 raw outcomes per locus
}
// ---------------------------------------------------------------------------
// Global Cartesian product (REQ-2.3)
// ---------------------------------------------------------------------------
function crossProduct(accumulated, next) {
    const result = [];
    for (const acc of accumulated) {
        for (const n of next) {
            // Biologically impossible: two sex-linked loci assigning conflicting sexes.
            if (acc.sex !== undefined && n.sex !== undefined && acc.sex !== n.sex)
                continue;
            result.push({ loci: [...acc.loci, ...n.loci], sex: acc.sex ?? n.sex });
        }
    }
    return result;
}
// ---------------------------------------------------------------------------
// Deduplication & aggregation (REQ-2.4 / REQ-2.5)
// ---------------------------------------------------------------------------
function deduplicate(outcomes, totalRaw) {
    const countMap = new Map();
    for (const outcome of outcomes) {
        const key = outcomeKey(outcome);
        const entry = countMap.get(key);
        if (entry) {
            entry.count++;
        }
        else {
            countMap.set(key, { outcome, count: 1 });
        }
    }
    return Array.from(countMap.values()).map(({ outcome, count }) => ({
        loci: outcome.loci.map((l) => ({ locusId: l.locusId, alleles: l.alleles })),
        decimalProbability: count / totalRaw,
        sex: outcome.sex,
    }));
}
function outcomeKey(outcome) {
    const lociPart = [...outcome.loci]
        .sort((a, b) => a.locusId.localeCompare(b.locusId))
        .map((l) => `${l.locusId}:${l.alleles[0]}|${l.alleles[1]}`)
        .join(';');
    return `${lociPart}~${outcome.sex ?? ''}`;
}
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isSexLinked(locusId, dictionary) {
    return dictionary.find((e) => e.locusId === locusId)?.inheritancePattern === 'sex-linked';
}
function requireLocus(genotype, locusId) {
    const locus = genotype.find((l) => l.locusId === locusId);
    if (!locus)
        throw new Error(`Locus "${locusId}" missing from genotype — MK-1 symmetry violated`);
    return locus;
}
function sortPair(a, b) {
    return a <= b ? [a, b] : [b, a];
}
//# sourceMappingURL=index.js.map