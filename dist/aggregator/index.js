"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aggregateOutcomes = aggregateOutcomes;
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function isNormal(alleleId) {
    return alleleId === 'normal';
}
// REQ-3.1: Recessive → visual only if homozygous mutant; dominant/incomplete_dominant/polygenic → visual if any allele is mutant.
function isVisualAtLocus(alleles, inheritance) {
    const [a, b] = alleles;
    if (inheritance === 'recessive') {
        return !isNormal(a) && !isNormal(b) && a === b;
    }
    return !isNormal(a) || !isNormal(b);
}
function isCarrierAtLocus(alleles) {
    const [a, b] = alleles;
    return (!isNormal(a) && isNormal(b)) || (isNormal(a) && !isNormal(b));
}
function collectVisualTraits(loci, dictionary) {
    const traits = [];
    for (const locus of loci) {
        const locusDef = dictionary.loci[locus.locusId];
        if (!locusDef || !isVisualAtLocus(locus.alleles, locusDef.inheritance))
            continue;
        // Deduplicate mutant alleles (handles homozygous recessive where both alleles are identical)
        const mutants = [...new Set(locus.alleles.filter((a) => !isNormal(a)))];
        for (const alleleId of mutants) {
            traits.push(locusDef.alleles[alleleId]?.name ?? alleleId);
        }
    }
    return traits;
}
function collectCongenitalWarnings(loci, dictionary) {
    const warnings = new Set();
    for (const locus of loci) {
        const locusDef = dictionary.loci[locus.locusId];
        if (!locusDef)
            continue;
        for (const alleleId of locus.alleles) {
            const defects = locusDef.alleles[alleleId]?.defects;
            if (defects) {
                for (const d of defects)
                    warnings.add(d);
            }
        }
    }
    return [...warnings];
}
function isLethalOutcome(loci, dictionary) {
    return dictionary.lethalCombos.some(({ triggerGenotype }) => Object.entries(triggerGenotype).every(([locusId, required]) => {
        const locus = loci.find((l) => l.locusId === locusId);
        if (!locus)
            return false;
        const [ra, rb] = required;
        const [a, b] = locus.alleles;
        return (a === ra && b === rb) || (a === rb && b === ra);
    }));
}
// REQ-3.3: Returns the matching combo's marketName, or undefined if no match.
function matchCombo(loci, dictionary) {
    return dictionary.combos.find(({ requiredGenotype }) => Object.entries(requiredGenotype).every(([locusId, required]) => {
        const locus = loci.find((l) => l.locusId === locusId);
        if (!locus)
            return false;
        const [ra, rb] = required;
        const [a, b] = locus.alleles;
        return (a === ra && b === rb) || (a === rb && b === ra);
    }))?.marketName;
}
// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
/**
 * MK-3: Translates raw GenotypeOutcome[] into human-readable AggregatedOutcome[].
 *
 * Performs visual determination, poss-het math, combo matching, lethal flagging,
 * congenital warning collection, and polygenic injection. Returns outcomes sorted
 * by descending decimalProbability.
 */
function aggregateOutcomes(outcomes, pair, dictionary) {
    // REQ-3.4: Deduplicated polygenics from both parents, injected into every outcome.
    const polygenics = [...new Set([...pair.sire.polygenics, ...pair.dam.polygenics])];
    // REQ-3.2: Precompute MARGINAL carrier and non-visual probability per recessive locus.
    //
    // Poss-het % must be a locus-level conditional probability:
    //   P(carrier at locus | non-visual at locus) = marginalCarrier / marginalNonVisual
    //
    // Using a full-genome outcome probability as the numerator was wrong: in a
    // multi-locus cross each individual outcome's probability is a fraction of the
    // product of all locus probabilities, so the ratio produced values like 13%
    // instead of the expected Mendelian 100%/66%/50%.  By marginalising across
    // all outcomes we recover a number that is independent of every other locus
    // (independent assortment) and matches standard Punnett-square expectations.
    const locusMargins = new Map();
    for (const outcome of outcomes) {
        for (const locus of outcome.loci) {
            const locusDef = dictionary.loci[locus.locusId];
            if (!locusDef || locusDef.inheritance !== 'recessive')
                continue;
            if (isVisualAtLocus(locus.alleles, 'recessive'))
                continue;
            const m = locusMargins.get(locus.locusId) ?? { nonVisual: 0, carrier: 0 };
            m.nonVisual += outcome.decimalProbability;
            if (isCarrierAtLocus(locus.alleles))
                m.carrier += outcome.decimalProbability;
            locusMargins.set(locus.locusId, m);
        }
    }
    const aggregated = outcomes.map((outcome) => {
        const phenotypeNames = collectVisualTraits(outcome.loci, dictionary);
        const possibleHets = [];
        for (const locus of outcome.loci) {
            const locusDef = dictionary.loci[locus.locusId];
            if (!locusDef || locusDef.inheritance !== 'recessive')
                continue;
            if (isVisualAtLocus(locus.alleles, 'recessive') || !isCarrierAtLocus(locus.alleles))
                continue;
            const m = locusMargins.get(locus.locusId);
            const probability = m && m.nonVisual > 0 ? m.carrier / m.nonVisual : 0;
            possibleHets.push({ locusId: locus.locusId, probability, isGuaranteed: probability >= 1.0 });
        }
        const comboName = matchCombo(outcome.loci, dictionary) ??
            (phenotypeNames.length > 0 ? phenotypeNames.join(' ') : undefined);
        return {
            genotype: outcome,
            phenotypeNames,
            comboName,
            decimalProbability: outcome.decimalProbability,
            percentageProbability: `${Math.round(outcome.decimalProbability * 100)}%`,
            possibleHets,
            isLethal: isLethalOutcome(outcome.loci, dictionary),
            congenitalWarnings: collectCongenitalWarnings(outcome.loci, dictionary),
            sex: outcome.sex,
            polygenics,
        };
    });
    return aggregated.sort((a, b) => b.decimalProbability - a.decimalProbability);
}
//# sourceMappingURL=index.js.map