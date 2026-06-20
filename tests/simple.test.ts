import { resolveSimpleInput } from '../src/simple';
import { calculateMorphs, calculateMorphsSimple } from '../src/index';
import { MorphkitDictionary, SimpleCalculationInput } from '../src/types';
import { mockDictionary } from './__mocks__/mockDictionary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function simple(sireMorphs: string[], damMorphs: string[] = []): SimpleCalculationInput {
  return {
    sire: { id: 'sire', sex: 'male', morphs: sireMorphs, polygenics: [] },
    dam: { id: 'dam', sex: 'female', morphs: damMorphs, polygenics: [] },
  };
}

function sireGenotype(input: SimpleCalculationInput) {
  return resolveSimpleInput(input, mockDictionary).input.sire.genotype;
}

function locus(input: SimpleCalculationInput, locusId: string) {
  return sireGenotype(input).find((l) => l.locusId === locusId);
}

// ---------------------------------------------------------------------------
// #1: inheritance-aware bare-name defaults
// ---------------------------------------------------------------------------

describe('#1 resolveSimpleInput — inheritance defaults', () => {
  it('recessive bare name → homozygous [name, name]', () => {
    expect(locus(simple(['Clown']), 'clown_locus')?.alleles).toEqual(['clown', 'clown']);
  });

  it('incomplete_dominant bare name → het [name, normal]', () => {
    expect(locus(simple(['Yellowbelly']), 'yellowbelly_complex')?.alleles).toEqual([
      'yellowbelly',
      'normal',
    ]);
  });

  it('dominant bare name → het [name, normal] with an informational message', () => {
    const { input, warnings } = resolveSimpleInput(simple(['Spider']), mockDictionary);
    expect(input.sire.genotype[0].alleles).toEqual(['spider', 'normal']);
    const w = warnings.find((x) => x.input === 'Spider');
    expect(w?.resolved).toBe(true);
    expect(w?.message).toMatch(/dominant/i);
  });

  it('is case-insensitive', () => {
    expect(locus(simple(['cLoWn']), 'clown_locus')?.alleles).toEqual(['clown', 'clown']);
  });
});

// ---------------------------------------------------------------------------
// #1: Het / Super / Possible-Het prefixes
// ---------------------------------------------------------------------------

describe('#1 resolveSimpleInput — prefixes', () => {
  it('"Het X" → [name, normal]', () => {
    expect(locus(simple(['Het Clown']), 'clown_locus')?.alleles).toEqual(['clown', 'normal']);
  });

  it('"Possible Het X" → [name, normal]', () => {
    expect(locus(simple(['Possible Het Clown']), 'clown_locus')?.alleles).toEqual([
      'clown',
      'normal',
    ]);
  });

  it('"66% Het X" → [name, normal]', () => {
    expect(locus(simple(['66% Het Clown']), 'clown_locus')?.alleles).toEqual(['clown', 'normal']);
  });

  it('"Super X" (incomplete_dominant) → homozygous [name, name]', () => {
    expect(locus(simple(['Super Yellowbelly']), 'yellowbelly_complex')?.alleles).toEqual([
      'yellowbelly',
      'yellowbelly',
    ]);
  });

  it('"Super X" on a recessive → still homozygous, but warns', () => {
    const { input, warnings } = resolveSimpleInput(simple(['Super Clown']), mockDictionary);
    expect(input.sire.genotype[0].alleles).toEqual(['clown', 'clown']);
    const w = warnings.find((x) => x.input === 'Super Clown');
    expect(w?.resolved).toBe(true);
    expect(w?.message).toMatch(/not a standard form|recessive/i);
  });
});

// ---------------------------------------------------------------------------
// #1: combo expansion
// ---------------------------------------------------------------------------

describe('#1 resolveSimpleInput — registered combos', () => {
  it('a combo name expands to its full requiredGenotype', () => {
    expect(locus(simple(['Freeway']), 'yellowbelly_complex')?.alleles).toEqual([
      'yellowbelly',
      'asphalt',
    ]);
  });

  it('a homozygous combo (Ivory) expands correctly', () => {
    expect(locus(simple(['Ivory']), 'yellowbelly_complex')?.alleles).toEqual([
      'yellowbelly',
      'yellowbelly',
    ]);
  });
});

// ---------------------------------------------------------------------------
// #1: locus merging
// ---------------------------------------------------------------------------

describe('#1 resolveSimpleInput — locus merging', () => {
  it('two single-allele morphs on one locus merge into [a, b]', () => {
    expect(locus(simple(['Yellowbelly', 'Asphalt']), 'yellowbelly_complex')?.alleles).toEqual([
      'yellowbelly',
      'asphalt',
    ]);
  });

  it('morphs on different loci stay separate', () => {
    const g = sireGenotype(simple(['Het Clown', 'Spider']));
    expect(g.find((l) => l.locusId === 'clown_locus')?.alleles).toEqual(['clown', 'normal']);
    expect(g.find((l) => l.locusId === 'spider_complex')?.alleles).toEqual(['spider', 'normal']);
  });

  it('a third allele on one locus overflows — excluded with a message', () => {
    const { input, warnings } = resolveSimpleInput(
      simple(['Yellowbelly', 'Asphalt', 'Super Yellowbelly']),
      mockDictionary,
    );
    // First two fill the locus; the third is dropped.
    expect(input.sire.genotype[0].alleles).toEqual(['yellowbelly', 'asphalt']);
    const w = warnings.find((x) => x.input === 'Super Yellowbelly');
    expect(w?.resolved).toBe(false);
    expect(w?.message).toMatch(/overflow|more than two/i);
  });
});

// ---------------------------------------------------------------------------
// #1: ambiguity / unknown
// ---------------------------------------------------------------------------

describe('#1 resolveSimpleInput — ambiguity and unknown', () => {
  it('an unknown name is unresolved, messaged, and excluded from the cross', () => {
    const { input, warnings } = resolveSimpleInput(simple(['Wobblegong']), mockDictionary);
    expect(input.sire.genotype).toHaveLength(0);
    const w = warnings.find((x) => x.input === 'Wobblegong');
    expect(w?.resolved).toBe(false);
    expect(w?.message).toMatch(/unknown morph/i);
  });

  it('a name mapping to more than one locus lists candidates and does not guess', () => {
    const ambiguousDict: MorphkitDictionary = {
      version: 'x',
      lastUpdated: 'x',
      polygenicTags: [],
      loci: {
        locus_a: {
          id: 'locus_a',
          name: 'A',
          inheritance: 'recessive',
          isSexLinked: false,
          alleles: { normal: { id: 'normal', name: 'Normal' }, ghost: { id: 'ghost', name: 'Ghost' } },
        },
        locus_b: {
          id: 'locus_b',
          name: 'B',
          inheritance: 'dominant',
          isSexLinked: false,
          alleles: { normal: { id: 'normal', name: 'Normal' }, ghost: { id: 'ghost', name: 'Ghost' } },
        },
      },
      combos: [],
      lethalCombos: [],
    };
    const { input, warnings } = resolveSimpleInput(simple(['Ghost']), ambiguousDict);
    expect(input.sire.genotype).toHaveLength(0);
    const w = warnings.find((x) => x.input === 'Ghost');
    expect(w?.resolved).toBe(false);
    expect(w?.message).toMatch(/ambiguous/i);
    expect(w?.message).toContain('locus_a');
    expect(w?.message).toContain('locus_b');
  });

  it('tags each warning with its parent', () => {
    const { warnings } = resolveSimpleInput(simple(['Clown'], ['Spider']), mockDictionary);
    expect(warnings.find((x) => x.input === 'Clown')?.parent).toBe('sire');
    expect(warnings.find((x) => x.input === 'Spider')?.parent).toBe('dam');
  });
});

// ---------------------------------------------------------------------------
// #1: desugars to the same pipeline (no duplicated genetics)
// ---------------------------------------------------------------------------

describe('#1 calculateMorphsSimple — reuses the existing pipeline', () => {
  it('het × het via the simple tier equals the equivalent complex calculation', () => {
    const { output } = calculateMorphsSimple(simple(['Het Clown'], ['Het Clown']), mockDictionary);
    const complex = calculateMorphs(
      {
        sire: {
          id: 'sire',
          sex: 'male',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
          polygenics: [],
        },
        dam: {
          id: 'dam',
          sex: 'female',
          genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
          polygenics: [],
        },
      },
      mockDictionary,
    );
    expect(output.outcomes).toEqual(complex.outcomes);
  });

  it('surfaces warnings alongside the output and still computes the resolved subset', () => {
    const { output, warnings } = calculateMorphsSimple(
      simple(['Het Clown', 'Wobblegong'], []),
      mockDictionary,
    );
    expect(warnings.some((w) => w.input === 'Wobblegong' && !w.resolved)).toBe(true);
    // The unknown morph is excluded; the clown cross still runs.
    const total = output.outcomes.reduce((s, o) => s + o.decimalProbability, 0);
    expect(total).toBeCloseTo(1.0, 10);
  });
});
