import { aggregateOutcomes } from '../src/aggregator';
import { computePunnettMatrix } from '../src/engine';
import { normalizeInput } from '../src/validation';
import {
  AggregatedOutcome,
  GenotypeOutcome,
  MorphkitCalculationInput,
} from '../src/types';
import { mockDictionary } from './__mocks__/mockDictionary';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePair(overrides: Partial<MorphkitCalculationInput> = {}) {
  return normalizeInput({
    sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
    dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    ...overrides,
  });
}

function findOutcome(
  outcomes: AggregatedOutcome[],
  locusId: string,
  alleles: [string, string],
): AggregatedOutcome | undefined {
  return outcomes.find((o) => {
    const locus = o.genotype.loci.find((l) => l.locusId === locusId);
    if (!locus) return false;
    const [a, b] = locus.alleles;
    const [x, y] = alleles;
    return (a === x && b === y) || (a === y && b === x);
  });
}

// ---------------------------------------------------------------------------
// AC-1: Recessive poss-het math (het × het cross → 66%)
// ---------------------------------------------------------------------------

describe('AC-1: het clown × het clown — recessive poss-het math', () => {
  let outcomes: AggregatedOutcome[];

  beforeAll(() => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);
  });

  it('het clown outcome does not include "Clown" in phenotypeNames', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['clown', 'normal']);
    expect(het).toBeDefined();
    expect(het!.phenotypeNames).not.toContain('Clown');
  });

  it('het clown outcome has a poss-het entry for clown_locus', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['clown', 'normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet).toBeDefined();
  });

  it('poss-het probability is 66% (2/3) for het × het cross', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['clown', 'normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(Math.floor(possHet!.probability * 100)).toBe(66);
  });

  it('poss-het isGuaranteed is false for het × het cross', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['clown', 'normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet!.isGuaranteed).toBe(false);
  });

  it('visual clown outcome includes "Clown" in phenotypeNames', () => {
    const visual = findOutcome(outcomes, 'clown_locus', ['clown', 'clown']);
    expect(visual).toBeDefined();
    expect(visual!.phenotypeNames).toContain('Clown');
    expect(visual!.possibleHets).toHaveLength(0);
  });

  it('normal/normal outcome has no possibleHets', () => {
    const clear = findOutcome(outcomes, 'clown_locus', ['normal', 'normal']);
    expect(clear).toBeDefined();
    expect(clear!.possibleHets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Poss-het: het × normal cross → 50%
// ---------------------------------------------------------------------------

describe('het clown × normal — poss-het is 50%', () => {
  it('carrier probability is 0.5 when non-visual pool is 100%', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['normal', 'normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    const het = findOutcome(outcomes, 'clown_locus', ['clown', 'normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet!.probability).toBe(0.5);
    expect(possHet!.isGuaranteed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Poss-het: visual clown × het clown → guaranteed hets
// ---------------------------------------------------------------------------

describe('super clown × het clown — guaranteed hets', () => {
  it('all non-visual offspring are guaranteed hets (isGuaranteed: true)', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'clown'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    const het = findOutcome(outcomes, 'clown_locus', ['clown', 'normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet!.probability).toBe(1.0);
    expect(possHet!.isGuaranteed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Combo matching resolves to market name
// ---------------------------------------------------------------------------

describe('AC-2: combo matching — yellowbelly + asphalt → "Freeway"', () => {
  it('comboName is "Freeway" when outcome carries both yellowbelly and asphalt', () => {
    const freewayOutcome: GenotypeOutcome = {
      loci: [{ locusId: 'yellowbelly_complex', alleles: ['asphalt', 'yellowbelly'] }],
      decimalProbability: 0.25,
    };
    const normalOutcome: GenotypeOutcome = {
      loci: [{ locusId: 'yellowbelly_complex', alleles: ['normal', 'normal'] }],
      decimalProbability: 0.75,
    };

    const pair = makePair();
    const outcomes = aggregateOutcomes([freewayOutcome, normalOutcome], pair, mockDictionary);
    const freeway = outcomes.find((o) => o.comboName === 'Freeway');
    expect(freeway).toBeDefined();
  });

  it('comboName is "Ivory" for homozygous yellowbelly', () => {
    const ivoryOutcome: GenotypeOutcome = {
      loci: [{ locusId: 'yellowbelly_complex', alleles: ['yellowbelly', 'yellowbelly'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair();
    const outcomes = aggregateOutcomes([ivoryOutcome], pair, mockDictionary);
    expect(outcomes[0].comboName).toBe('Ivory');
  });

  it('comboName is joined trait name when no combo matches', () => {
    const yellowbellyOnly: GenotypeOutcome = {
      loci: [{ locusId: 'yellowbelly_complex', alleles: ['normal', 'yellowbelly'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair();
    const outcomes = aggregateOutcomes([yellowbellyOnly], pair, mockDictionary);
    expect(outcomes[0].comboName).toBe('Yellowbelly');
  });
});

// ---------------------------------------------------------------------------
// AC-3: Polygenics injected into every outcome
// ---------------------------------------------------------------------------

describe('AC-3: polygenics injection', () => {
  it('every outcome contains the polygenics from the sire', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: ['Jungle'],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['normal', 'normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) {
      expect(outcome.polygenics).toContain('Jungle');
    }
  });

  it('deduplicates polygenics shared by both parents', () => {
    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype: [], polygenics: ['Jungle'] },
      dam: { id: 'dam', sex: 'female', genotype: [], polygenics: ['Jungle'] },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    expect(outcomes[0].polygenics).toEqual(['Jungle']);
  });

  it('polygenics are empty when neither parent carries any', () => {
    const pair = makePair();
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    for (const outcome of outcomes) {
      expect(outcome.polygenics).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// MK-4 AC-1: Lethal genotype is flagged but probability is never redistributed
// ---------------------------------------------------------------------------

describe('MK-4 AC-1: lethal genotype is flagged but probability is never redistributed', () => {
  let outcomes: ReturnType<typeof aggregateOutcomes>;

  beforeAll(() => {
    const pair = makePair();
    const genotypes: GenotypeOutcome[] = [
      { loci: [{ locusId: 'spider_complex', alleles: ['spider', 'spider'] }], decimalProbability: 0.25 },
      { loci: [{ locusId: 'spider_complex', alleles: ['normal', 'spider'] }], decimalProbability: 0.5 },
      { loci: [{ locusId: 'spider_complex', alleles: ['normal', 'normal'] }], decimalProbability: 0.25 },
    ];
    outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);
  });

  it('all three outcomes are present — none are dropped', () => {
    expect(outcomes).toHaveLength(3);
  });

  it('lethal outcome has isLethal: true', () => {
    const lethal = outcomes.find((o) =>
      o.genotype.loci[0].alleles[0] === 'spider' &&
      o.genotype.loci[0].alleles[1] === 'spider',
    );
    expect(lethal!.isLethal).toBe(true);
  });

  it('lethal outcome retains its exact decimalProbability of 0.25', () => {
    const lethal = outcomes.find((o) =>
      o.genotype.loci[0].alleles[0] === 'spider' &&
      o.genotype.loci[0].alleles[1] === 'spider',
    );
    expect(lethal!.decimalProbability).toBe(0.25);
  });

  it('non-lethal outcomes have isLethal: false', () => {
    const survivors = outcomes.filter((o) => !o.isLethal);
    expect(survivors.length).toBe(2);
    expect(survivors.every((o) => o.isLethal === false)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// MK-4 AC-2: Epistatic defect fires independently of visual determination
// ---------------------------------------------------------------------------

describe('MK-4 AC-2: black_head epistatically masks spider — wobble warning still fires', () => {
  it('congenitalWarnings includes "Neurological Wobble" even though "Spider" is absent from comboName', () => {
    // black_head_complex + spider_complex het → no combo in mockDictionary for this pair,
    // so comboName is the joined trait names; spider allele defect must still fire.
    const blackHeadSpider: GenotypeOutcome = {
      loci: [
        { locusId: 'black_head_complex', alleles: ['black_head', 'normal'] },
        { locusId: 'spider_complex', alleles: ['normal', 'spider'] },
      ],
      decimalProbability: 1.0,
    };
    const pair = makePair();
    const outcomes = aggregateOutcomes([blackHeadSpider], pair, mockDictionary);

    expect(outcomes[0].congenitalWarnings).toContain('Neurological Wobble');
  });
});

// ---------------------------------------------------------------------------
// MK-4 AC-3: Wild-type outcome carries no lethality or defects
// ---------------------------------------------------------------------------

describe('MK-4 AC-3: wild-type outcome is clean', () => {
  it('isLethal: false and congenitalWarnings: [] for a fully normal genotype', () => {
    const normal: GenotypeOutcome = {
      loci: [
        { locusId: 'spider_complex', alleles: ['normal', 'normal'] },
        { locusId: 'clown_locus', alleles: ['normal', 'normal'] },
      ],
      decimalProbability: 1.0,
    };
    const pair = makePair();
    const outcomes = aggregateOutcomes([normal], pair, mockDictionary);

    expect(outcomes[0].isLethal).toBe(false);
    expect(outcomes[0].congenitalWarnings).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Congenital warnings from allele defects
// ---------------------------------------------------------------------------

describe('congenital warnings from allele defects', () => {
  it('spider het carries "Neurological Wobble" warning', () => {
    const het: GenotypeOutcome = {
      loci: [{ locusId: 'spider_complex', alleles: ['normal', 'spider'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair();
    const outcomes = aggregateOutcomes([het], pair, mockDictionary);
    expect(outcomes[0].congenitalWarnings).toContain('Neurological Wobble');
  });

  it('normal animal has no congenital warnings', () => {
    const normal: GenotypeOutcome = {
      loci: [{ locusId: 'spider_complex', alleles: ['normal', 'normal'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair();
    const outcomes = aggregateOutcomes([normal], pair, mockDictionary);
    expect(outcomes[0].congenitalWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Output ordering
// ---------------------------------------------------------------------------

describe('output is sorted by descending probability', () => {
  it('most probable outcome appears first', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    for (let i = 1; i < outcomes.length; i++) {
      expect(outcomes[i - 1].decimalProbability).toBeGreaterThanOrEqual(
        outcomes[i].decimalProbability,
      );
    }
  });
});
