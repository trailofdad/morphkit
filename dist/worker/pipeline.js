"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runCalculationPipeline = runCalculationPipeline;
const aggregator_1 = require("../aggregator");
const engine_1 = require("../engine");
const validation_1 = require("../validation");
/**
 * Maps MorphkitDictionary → CdnDictionary for MK-2.
 * The engine only uses CdnDictionary to detect sex-linked loci; non-sex-linked
 * entries are mapped to the nearest InheritancePattern equivalent.
 */
function deriveCdnDictionary(dictionary) {
    return Object.values(dictionary.loci).map((locus) => {
        let inheritancePattern;
        if (locus.isSexLinked) {
            inheritancePattern = 'sex-linked';
        }
        else if (locus.inheritance === 'incomplete_dominant') {
            inheritancePattern = 'co-dominant';
        }
        else if (locus.inheritance === 'polygenic') {
            inheritancePattern = 'recessive';
        }
        else {
            inheritancePattern = locus.inheritance;
        }
        return { locusId: locus.id, inheritancePattern };
    });
}
/**
 * MK-5 orchestration: runs the full MK-1 → MK-2 → MK-3/4 pipeline
 * synchronously and returns the final output. Throws on any validation
 * or engine error — callers are responsible for catching.
 */
function runCalculationPipeline(input, dictionary) {
    const normalizedPair = (0, validation_1.normalizeInput)(input);
    const cdnDictionary = deriveCdnDictionary(dictionary);
    const genotypeOutcomes = (0, engine_1.computePunnettMatrix)(normalizedPair, cdnDictionary);
    const aggregatedOutcomes = (0, aggregator_1.aggregateOutcomes)(genotypeOutcomes, normalizedPair, dictionary);
    return {
        outcomes: aggregatedOutcomes,
        normalizedInput: normalizedPair,
        calculatedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=pipeline.js.map