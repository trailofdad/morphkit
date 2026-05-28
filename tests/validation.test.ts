import { normalizeInput } from '../src/validation';
import {
  MorphkitCalculationInput,
  InvalidGenotypeError,
  SchemaValidationError,
} from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<MorphkitCalculationInput> = {}): MorphkitCalculationInput {
  return {
    sire: {
      id: 'sire-1',
      sex: 'male',
      genotype: [],
      polygenics: [],
    },
    dam: {
      id: 'dam-1',
      sex: 'female',
      genotype: [],
      polygenics: [],
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// REQ-1.5 + REQ-1.6 — AC-1: Normalization and locus symmetry
// ---------------------------------------------------------------------------

describe('AC-1: locus normalization and symmetry', () => {
  it('expands a single-allele sire locus to [allele, "normal"]', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown'] }],
          polygenics: [],
        },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [],
          polygenics: [],
        },
      }),
    );

    const sireLocus = result.sire.genotype.find((l) => l.locusId === 'clown_locus');
    expect(sireLocus?.alleles).toEqual(['clown', 'normal']);
  });

  it('coerces mixed-case input alleles to lowercase', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
          polygenics: [],
        },
      }),
    );

    const sireLocus = result.sire.genotype.find((l) => l.locusId === 'clown_locus');
    expect(sireLocus?.alleles).toEqual(['clown', 'normal']);
  });

  it('coerces mixed-case locusId to lowercase', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [{ locusId: 'Clown_Locus', alleles: ['clown'] }],
          polygenics: [],
        },
      }),
    );

    expect(result.sire.genotype[0].locusId).toBe('clown_locus');
  });

  it('injects ["normal", "normal"] into dam when locus only present on sire', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown'] }],
          polygenics: [],
        },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [],
          polygenics: [],
        },
      }),
    );

    const damLocus = result.dam.genotype.find((l) => l.locusId === 'clown_locus');
    expect(damLocus?.alleles).toEqual(['normal', 'normal']);
  });

  it('injects ["normal", "normal"] into sire when locus only present on dam', () => {
    const result = normalizeInput(
      makeInput({
        sire: { id: 'sire-1', sex: 'male', genotype: [], polygenics: [] },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [{ locusId: 'pastel_locus', alleles: ['pastel'] }],
          polygenics: [],
        },
      }),
    );

    const sireLocus = result.sire.genotype.find((l) => l.locusId === 'pastel_locus');
    expect(sireLocus?.alleles).toEqual(['normal', 'normal']);
  });

  it('passes through a two-allele locus with lowercasing applied', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'clown'] }],
          polygenics: [],
        },
      }),
    );

    const sireLocus = result.sire.genotype.find((l) => l.locusId === 'clown_locus');
    expect(sireLocus?.alleles).toEqual(['clown', 'clown']);
  });

  it('handles multiple loci with mixed symmetry', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [
            { locusId: 'clown_locus', alleles: ['clown'] },
            { locusId: 'spider_complex', alleles: ['spider', 'normal'] },
          ],
          polygenics: [],
        },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown'] }],
          polygenics: [],
        },
      }),
    );

    expect(result.sire.genotype).toHaveLength(2);
    expect(result.dam.genotype).toHaveLength(2);

    const damSpider = result.dam.genotype.find((l) => l.locusId === 'spider_complex');
    expect(damSpider?.alleles).toEqual(['normal', 'normal']);
  });

  it('preserves polygenics on both animals', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [],
          polygenics: ['Jungle', 'Black Back'],
        },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [],
          polygenics: ['Desert Ghost'],
        },
      }),
    );

    expect(result.sire.polygenics).toEqual(['Jungle', 'Black Back']);
    expect(result.dam.polygenics).toEqual(['Desert Ghost']);
  });
});

// ---------------------------------------------------------------------------
// REQ-1.2 — AC-2: Sex enforcement
// ---------------------------------------------------------------------------

describe('AC-2: sex enforcement', () => {
  it('throws SchemaValidationError when sire.sex is missing', () => {
    const input = makeInput({
      sire: { id: 'sire-1', sex: undefined, genotype: [], polygenics: [] },
    });

    expect(() => normalizeInput(input)).toThrow(SchemaValidationError);
  });

  it('sets field to "sire.sex" in the thrown error', () => {
    const input = makeInput({
      sire: { id: 'sire-1', sex: undefined, genotype: [], polygenics: [] },
    });

    try {
      normalizeInput(input);
      fail('expected SchemaValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).field).toBe('sire.sex');
    }
  });

  it('throws SchemaValidationError when dam.sex is missing', () => {
    const input = makeInput({
      dam: { id: 'dam-1', sex: undefined, genotype: [], polygenics: [] },
    });

    expect(() => normalizeInput(input)).toThrow(SchemaValidationError);
  });

  it('sets field to "dam.sex" in the thrown error', () => {
    const input = makeInput({
      dam: { id: 'dam-1', sex: undefined, genotype: [], polygenics: [] },
    });

    try {
      normalizeInput(input);
      fail('expected SchemaValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(SchemaValidationError);
      expect((err as SchemaValidationError).field).toBe('dam.sex');
    }
  });

  it('throws SchemaValidationError for an invalid sex value', () => {
    const input = makeInput({
      sire: {
        id: 'sire-1',
        sex: 'unknown' as 'male',
        genotype: [],
        polygenics: [],
      },
    });

    expect(() => normalizeInput(input)).toThrow(SchemaValidationError);
  });
});

// ---------------------------------------------------------------------------
// REQ-1.4 — AC-3: Allele cardinality
// ---------------------------------------------------------------------------

describe('AC-3: allele cardinality', () => {
  it('throws InvalidGenotypeError when a locus has 3 alleles', () => {
    const input = makeInput({
      sire: {
        id: 'sire-1',
        sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'pastel', 'normal'] }],
        polygenics: [],
      },
    });

    expect(() => normalizeInput(input)).toThrow(InvalidGenotypeError);
  });

  it('sets locusId on the thrown InvalidGenotypeError', () => {
    const input = makeInput({
      sire: {
        id: 'sire-1',
        sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'pastel', 'normal'] }],
        polygenics: [],
      },
    });

    try {
      normalizeInput(input);
      fail('expected InvalidGenotypeError');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidGenotypeError);
      expect((err as InvalidGenotypeError).locusId).toBe('clown_locus');
    }
  });

  it('throws SchemaValidationError when a locus has 0 alleles', () => {
    const input = makeInput({
      sire: {
        id: 'sire-1',
        sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: [] }],
        polygenics: [],
      },
    });

    expect(() => normalizeInput(input)).toThrow(SchemaValidationError);
  });
});

// ---------------------------------------------------------------------------
// REQ-1.3 — calculationMode routing
// ---------------------------------------------------------------------------

describe('REQ-1.3: calculationMode routing', () => {
  it('defaults calculationMode to "standard" when omitted', () => {
    const result = normalizeInput(makeInput());
    expect(result.calculationMode).toBe('standard');
  });

  it('preserves "diagnostic" when explicitly set', () => {
    const result = normalizeInput(makeInput({ calculationMode: 'diagnostic' }));
    expect(result.calculationMode).toBe('diagnostic');
  });

  it('preserves "standard" when explicitly set', () => {
    const result = normalizeInput(makeInput({ calculationMode: 'standard' }));
    expect(result.calculationMode).toBe('standard');
  });
});

// ---------------------------------------------------------------------------
// Output shape guarantees
// ---------------------------------------------------------------------------

describe('output shape', () => {
  it('always produces exactly 2 alleles on every normalized locus', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [
            { locusId: 'a', alleles: ['x'] },
            { locusId: 'b', alleles: ['y', 'z'] },
          ],
          polygenics: [],
        },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [{ locusId: 'a', alleles: ['w'] }],
          polygenics: [],
        },
      }),
    );

    for (const locus of result.sire.genotype) {
      expect(locus.alleles).toHaveLength(2);
    }
    for (const locus of result.dam.genotype) {
      expect(locus.alleles).toHaveLength(2);
    }
  });

  it('sire and dam have identical locusId sets after normalization', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1',
          sex: 'male',
          genotype: [
            { locusId: 'clown_locus', alleles: ['clown'] },
            { locusId: 'spider_complex', alleles: ['spider'] },
          ],
          polygenics: [],
        },
        dam: {
          id: 'dam-1',
          sex: 'female',
          genotype: [{ locusId: 'pastel_locus', alleles: ['pastel'] }],
          polygenics: [],
        },
      }),
    );

    const sireIds = new Set(result.sire.genotype.map((l) => l.locusId));
    const damIds = new Set(result.dam.genotype.map((l) => l.locusId));
    expect(sireIds).toEqual(damIds);
  });

  it('does not mutate the original input', () => {
    const original = makeInput({
      sire: {
        id: 'sire-1',
        sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown'] }],
        polygenics: [],
      },
    });
    const originalGenotypeLength = original.sire.genotype.length;

    normalizeInput(original);

    expect(original.sire.genotype).toHaveLength(originalGenotypeLength);
    expect(original.dam.genotype).toHaveLength(0);
  });
});
