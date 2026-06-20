import { collectPolygenicWarnings, normalizeInput } from '../src/validation';
import {
  MorphkitCalculationInput,
  MorphkitDictionary,
  InvalidGenotypeError,
  SchemaValidationError,
} from '../src/types';
import { mockDictionary } from './__mocks__/mockDictionary';

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

// ---------------------------------------------------------------------------
// REQ-7 + REQ-9 — dictionary-aware alias resolution and validation (MK-1)
// ---------------------------------------------------------------------------

describe('dictionary-aware MK-1 (aliases + validation)', () => {
  const dict: MorphkitDictionary = {
    version: '0.0.0-test',
    lastUpdated: '2026-06-19T00:00:00Z',
    polygenicTags: [],
    combos: [],
    lethalCombos: [],
    loci: {
      albino_complex: {
        id: 'albino_complex',
        name: 'Albino',
        inheritance: 'recessive',
        isSexLinked: false,
        alleles: {
          normal: { id: 'normal', name: 'Normal' },
          candy: { id: 'candy', name: 'Candy', aliases: ['Toffee'] },
        },
      },
    },
  };

  function sireGenotype(input: MorphkitCalculationInput, locusId: string) {
    return normalizeInput(input, dict).sire.genotype.find((l) => l.locusId === locusId);
  }

  it('resolves a synonym (Toffee) to its canonical allele id (candy)', () => {
    const locus = sireGenotype(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [{ locusId: 'albino_complex', alleles: ['Toffee', 'normal'] }],
          polygenics: [],
        },
      }),
      'albino_complex',
    );
    expect(locus?.alleles).toEqual(['candy', 'normal']);
  });

  it('merges a synonym + canonical into a homozygote (Toffee × Candy → [candy, candy])', () => {
    const locus = sireGenotype(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [{ locusId: 'albino_complex', alleles: ['Toffee', 'Candy'] }],
          polygenics: [],
        },
      }),
      'albino_complex',
    );
    expect(locus?.alleles).toEqual(['candy', 'candy']);
  });

  it('throws SchemaValidationError for an unknown locus', () => {
    expect(() =>
      normalizeInput(
        makeInput({
          sire: {
            id: 'sire-1', sex: 'male',
            genotype: [{ locusId: 'made_up_locus', alleles: ['whatever'] }],
            polygenics: [],
          },
        }),
        dict,
      ),
    ).toThrow(SchemaValidationError);
  });

  it('throws InvalidGenotypeError for an allele not defined on its locus', () => {
    try {
      normalizeInput(
        makeInput({
          sire: {
            id: 'sire-1', sex: 'male',
            genotype: [{ locusId: 'albino_complex', alleles: ['spider', 'normal'] }],
            polygenics: [],
          },
        }),
        dict,
      );
      fail('expected InvalidGenotypeError');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidGenotypeError);
      expect((err as InvalidGenotypeError).locusId).toBe('albino_complex');
    }
  });

  it('without a dictionary, passes through unknown loci/alleles (backward compatible)', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [{ locusId: 'made_up_locus', alleles: ['whatever'] }],
          polygenics: [],
        },
      }),
    );
    const locus = result.sire.genotype.find((l) => l.locusId === 'made_up_locus');
    expect(locus?.alleles).toEqual(['whatever', 'normal']);
  });
});

// ---------------------------------------------------------------------------
// REQ-5 — sex-linked sexChromosomes normalization (MK-1)
// ---------------------------------------------------------------------------

describe('sexChromosomes normalization', () => {
  it('carries a two-entry annotation through unchanged (uppercased)', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [
            {
              locusId: 'banana_locus',
              alleles: ['banana', 'normal'],
              sexChromosomes: ['x', 'y'] as unknown as ('X' | 'Y')[],
            },
          ],
          polygenics: [],
        },
      }),
    );
    const locus = result.sire.genotype.find((l) => l.locusId === 'banana_locus');
    expect(locus?.sexChromosomes).toEqual(['X', 'Y']);
  });

  it('expands a single-allele annotation, putting the injected normal on the opposite chromosome', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [{ locusId: 'banana_locus', alleles: ['banana'], sexChromosomes: ['Y'] }],
          polygenics: [],
        },
      }),
    );
    const locus = result.sire.genotype.find((l) => l.locusId === 'banana_locus');
    expect(locus?.alleles).toEqual(['banana', 'normal']);
    expect(locus?.sexChromosomes).toEqual(['Y', 'X']);
  });

  it('throws SchemaValidationError for an invalid chromosome value', () => {
    expect(() =>
      normalizeInput(
        makeInput({
          sire: {
            id: 'sire-1', sex: 'male',
            genotype: [
              { locusId: 'banana_locus', alleles: ['banana', 'normal'], sexChromosomes: ['Z', 'X'] as ('X' | 'Y')[] },
            ],
            polygenics: [],
          },
        }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it('leaves autosomal loci without a sexChromosomes field', () => {
    const result = normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
          polygenics: [],
        },
      }),
    );
    const locus = result.sire.genotype.find((l) => l.locusId === 'clown_locus');
    expect(locus?.sexChromosomes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// REQ-12 — carrier zygosity (het / pos_het)
// ---------------------------------------------------------------------------

describe('carrier zygosity normalization', () => {
  function sireLocus(zygosity: 'het' | 'pos_het', carrierProbability?: number) {
    return normalizeInput(
      makeInput({
        sire: {
          id: 'sire-1', sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown'], zygosity, carrierProbability }],
          polygenics: [],
        },
      }),
    ).sire.genotype.find((l) => l.locusId === 'clown_locus');
  }

  it("'het' expands to a definite [mutant, normal] carrier with no carrierProbability", () => {
    const locus = sireLocus('het');
    expect(locus?.alleles).toEqual(['clown', 'normal']);
    expect(locus?.carrierProbability).toBeUndefined();
  });

  it("'pos_het' defaults to a 0.5 carrierProbability", () => {
    const locus = sireLocus('pos_het');
    expect(locus?.alleles).toEqual(['clown', 'normal']);
    expect(locus?.carrierProbability).toBe(0.5);
  });

  it("'pos_het' honors an explicit carrierProbability (e.g. 66%)", () => {
    expect(sireLocus('pos_het', 0.66)?.carrierProbability).toBe(0.66);
  });

  it('throws for a carrierProbability outside 0–1', () => {
    expect(() => sireLocus('pos_het', 1.5)).toThrow(SchemaValidationError);
  });

  it('throws when zygosity is given without a mutant allele', () => {
    expect(() =>
      normalizeInput(
        makeInput({
          sire: {
            id: 'sire-1', sex: 'male',
            genotype: [{ locusId: 'clown_locus', alleles: ['normal'], zygosity: 'pos_het' }],
            polygenics: [],
          },
        }),
      ),
    ).toThrow(SchemaValidationError);
  });
});

// ---------------------------------------------------------------------------
// Issue #20 — soft polygenic-tag validation (collectPolygenicWarnings)
// ---------------------------------------------------------------------------

describe('collectPolygenicWarnings', () => {
  // mockDictionary.polygenicTags === ["Jungle", "Black Back"]
  function warningsFor(sireTags: string[], damTags: string[] = []): ReturnType<typeof collectPolygenicWarnings> {
    const pair = normalizeInput(
      makeInput({
        sire: { id: 'sire-1', sex: 'male', genotype: [], polygenics: sireTags },
        dam: { id: 'dam-1', sex: 'female', genotype: [], polygenics: damTags },
      }),
      mockDictionary,
    );
    return collectPolygenicWarnings(pair, mockDictionary);
  }

  it('emits no warning for a known tag', () => {
    expect(warningsFor(['Jungle'])).toEqual([]);
  });

  it('matches known tags case-insensitively', () => {
    expect(warningsFor(['jUnGlE', 'black back'])).toEqual([]);
  });

  it('warns for an unknown tag, naming it with the unknown_polygenic_tag code', () => {
    const warnings = warningsFor(['Jungel']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('unknown_polygenic_tag');
    expect(warnings[0].message).toContain('Jungel');
  });

  it('does not throw or drop the tag (advisory only)', () => {
    const pair = normalizeInput(
      makeInput({
        sire: { id: 'sire-1', sex: 'male', genotype: [], polygenics: ['Jungel'] },
      }),
      mockDictionary,
    );
    // The tag survives normalization untouched — only a separate warning is raised.
    expect(pair.sire.polygenics).toContain('Jungel');
    expect(() => collectPolygenicWarnings(pair, mockDictionary)).not.toThrow();
  });

  it('deduplicates an unknown tag carried by both parents into one warning', () => {
    expect(warningsFor(['Jungel'], ['jungel'])).toHaveLength(1);
  });

  it('returns one warning per distinct unknown tag', () => {
    const warnings = warningsFor(['Jungel', 'Stripey'], ['Black Back']);
    expect(warnings.map((w) => w.message).join(' ')).toContain('Jungel');
    expect(warnings.map((w) => w.message).join(' ')).toContain('Stripey');
    expect(warnings).toHaveLength(2);
  });
});
