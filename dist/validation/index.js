"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeInput = normalizeInput;
const types_1 = require("../types");
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
function normalizeInput(input) {
    const sire = normalizeAnimal(input.sire, 'sire');
    const dam = normalizeAnimal(input.dam, 'dam');
    const { sire: symmetricSire, dam: symmetricDam } = ensureLocusSymmetry(sire, dam);
    const calculationMode = input.calculationMode ?? 'standard';
    return { calculationMode, sire: symmetricSire, dam: symmetricDam };
}
function requireSex(animal, role) {
    if (animal.sex !== 'male' && animal.sex !== 'female') {
        throw new types_1.SchemaValidationError(`${role}.sex must be "male" or "female"`, `${role}.sex`);
    }
    return animal.sex;
}
function normalizeAnimal(animal, role) {
    const sex = requireSex(animal, role);
    const genotype = animal.genotype.map((locus, i) => normalizeLocus(locus, `${role}.genotype[${i}]`));
    return { id: animal.id, sex, genotype, polygenics: [...animal.polygenics] };
}
function normalizeLocus(locus, path) {
    if (locus.alleles.length > 2) {
        throw new types_1.InvalidGenotypeError(`Locus at ${path} has ${locus.alleles.length} alleles; maximum is 2`, locus.locusId.toLowerCase());
    }
    if (locus.alleles.length === 0) {
        throw new types_1.SchemaValidationError(`Locus at ${path} has no alleles; minimum is 1`, path);
    }
    const alleles = locus.alleles.length === 2
        ? [locus.alleles[0].toLowerCase(), locus.alleles[1].toLowerCase()]
        : [locus.alleles[0].toLowerCase(), 'normal'];
    return { locusId: locus.locusId.toLowerCase(), alleles };
}
function ensureLocusSymmetry(sire, dam) {
    const sireIds = new Set(sire.genotype.map((l) => l.locusId));
    const damIds = new Set(dam.genotype.map((l) => l.locusId));
    const placeholder = ['normal', 'normal'];
    const sireExtra = [...damIds]
        .filter((id) => !sireIds.has(id))
        .map((locusId) => ({ locusId, alleles: placeholder }));
    const damExtra = [...sireIds]
        .filter((id) => !damIds.has(id))
        .map((locusId) => ({ locusId, alleles: placeholder }));
    return {
        sire: { ...sire, genotype: [...sire.genotype, ...sireExtra] },
        dam: { ...dam, genotype: [...dam.genotype, ...damExtra] },
    };
}
//# sourceMappingURL=index.js.map