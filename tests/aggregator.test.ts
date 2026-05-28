import { aggregateOutcomes } from '../src/aggregator';
import { computePunnettMatrix } from '../src/engine';
import { normalizeInput } from '../src/validation';
import {
  AggregatedOutcome,
  GenotypeOutcome,
  MorphkitCalculationInput,
  MorphkitDictionary,
} from '../src/types';

// ---------------------------------------------------------------------------
// Shared test dictionary
// ---------------------------------------------------------------------------

const DICT: MorphkitDictionary = {
  version: '1.0.0',
  lastUpdated: '2026-01-01',
  loci: {
    clown_locus: {
      id: 'clown_locus',
      name: 'Clown',
      inheritance: 'recessive',
      isSexLinked: false,
      alleles: {
        Clown: { id: 'Clown', name: 'Clown' },
        Normal: { id: 'Normal', name: 'Normal' },
      },
    },
    spider_locus: {
      id: 'spider_locus',
      name: 'Spider',
      inheritance: 'dominant',
      isSexLinked: false,
      alleles: {
        Spider: { id: 'Spider', name: 'Spider', defects: ['Neurological Wobble'] },
        Normal: { id: 'Normal', name: 'Normal' },
      },
    },
    yb_complex: {
      id: 'yb_complex',
      name: 'Yellowbelly Complex',
      inheritance: 'incomplete_dominant',
      isSexLinked: false,
      alleles: {
        Yellowbelly: { id: 'Yellowbelly', name: 'Yellowbelly' },
        Asphalt: { id: 'Asphalt', name: 'Asphalt' },
        Normal: { id: 'Normal', name: 'Normal' },
      },
    },
  },
  combos: [
    {
      marketName: 'Freeway',
      requiredGenotype: { yb_complex: ['Yellowbelly', 'Asphalt'] },
    },
  ],
  lethalCombos: [
    { triggerGenotype: { spider_locus: ['Spider', 'Spider'] } },
  ],
  polygenicTags: ['Jungle'],
};

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

describe('AC-1: het Clown × het Clown — recessive poss-het math', () => {
  let outcomes: AggregatedOutcome[];

  beforeAll(() => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    outcomes = aggregateOutcomes(genotypes, pair, DICT);
  });

  it('het Clown outcome does not include "Clown" in phenotypeNames', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['Clown', 'Normal']);
    expect(het).toBeDefined();
    expect(het!.phenotypeNames).not.toContain('Clown');
  });

  it('het Clown outcome has a poss-het entry for clown_locus', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['Clown', 'Normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet).toBeDefined();
  });

  it('poss-het probability is 66% (2/3) for het × het cross', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['Clown', 'Normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(Math.floor(possHet!.probability * 100)).toBe(66);
  });

  it('poss-het isGuaranteed is false for het × het cross', () => {
    const het = findOutcome(outcomes, 'clown_locus', ['Clown', 'Normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet!.isGuaranteed).toBe(false);
  });

  it('visual Clown outcome includes "Clown" in phenotypeNames', () => {
    const visual = findOutcome(outcomes, 'clown_locus', ['Clown', 'Clown']);
    expect(visual).toBeDefined();
    expect(visual!.phenotypeNames).toContain('Clown');
    expect(visual!.possibleHets).toHaveLength(0);
  });

  it('Normal/Normal outcome has no possibleHets', () => {
    const clear = findOutcome(outcomes, 'clown_locus', ['Normal', 'Normal']);
    expect(clear).toBeDefined();
    expect(clear!.possibleHets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Poss-het: het × normal cross → 50%
// ---------------------------------------------------------------------------

describe('het Clown × Normal — poss-het is 50%', () => {
  it('carrier probability is 0.5 when non-visual pool is 100%', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['Normal', 'Normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, DICT);

    const het = findOutcome(outcomes, 'clown_locus', ['Clown', 'Normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet!.probability).toBe(0.5);
    expect(possHet!.isGuaranteed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Poss-het: visual Clown × het Clown → guaranteed hets
// ---------------------------------------------------------------------------

describe('Super Clown × het Clown — guaranteed hets', () => {
  it('all non-visual offspring are guaranteed hets (isGuaranteed: true)', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Clown'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, DICT);

    const het = findOutcome(outcomes, 'clown_locus', ['Clown', 'Normal']);
    const possHet = het!.possibleHets.find((p) => p.locusId === 'clown_locus');
    expect(possHet!.probability).toBe(1.0);
    expect(possHet!.isGuaranteed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-2: Combo matching resolves to market name
// ---------------------------------------------------------------------------

describe('AC-2: combo matching — Yellowbelly + Asphalt → "Freeway"', () => {
  it('comboName is "Freeway" when outcome carries both Yellowbelly and Asphalt', () => {
    // Hand-craft a GenotypeOutcome that has the Freeway allele combination.
    const freewaySireGenotype: GenotypeOutcome = {
      loci: [{ locusId: 'yb_complex', alleles: ['Asphalt', 'Yellowbelly'] }],
      decimalProbability: 0.25,
    };
    const normalGenotype: GenotypeOutcome = {
      loci: [{ locusId: 'yb_complex', alleles: ['Normal', 'Normal'] }],
      decimalProbability: 0.75,
    };

    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
      dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    });

    const outcomes = aggregateOutcomes([freewaySireGenotype, normalGenotype], pair, DICT);
    const freeway = outcomes.find((o) => o.comboName === 'Freeway');
    expect(freeway).toBeDefined();
  });

  it('comboName is joined trait names when no combo matches', () => {
    const yellowbellyOnly: GenotypeOutcome = {
      loci: [{ locusId: 'yb_complex', alleles: ['Normal', 'Yellowbelly'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
      dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    });

    const outcomes = aggregateOutcomes([yellowbellyOnly], pair, DICT);
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
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: ['Jungle'],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['Normal', 'Normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, DICT);

    expect(outcomes.length).toBeGreaterThan(0);
    for (const outcome of outcomes) {
      expect(outcome.polygenics).toContain('Jungle');
    }
  });

  it('deduplicates polygenics shared by both parents', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male', genotype: [],
        polygenics: ['Jungle'],
      },
      dam: {
        id: 'dam', sex: 'female', genotype: [],
        polygenics: ['Jungle'],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, DICT);

    expect(outcomes[0].polygenics).toEqual(['Jungle']);
  });

  it('polygenics are empty when neither parent carries any', () => {
    const pair = makePair();
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, DICT);

    for (const outcome of outcomes) {
      expect(outcome.polygenics).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Lethal combo detection
// ---------------------------------------------------------------------------

describe('Lethal combo: homozygous Spider', () => {
  it('flags isLethal: true on the Super Spider outcome', () => {
    const superSpider: GenotypeOutcome = {
      loci: [{ locusId: 'spider_locus', alleles: ['Spider', 'Spider'] }],
      decimalProbability: 0.25,
    };
    const het: GenotypeOutcome = {
      loci: [{ locusId: 'spider_locus', alleles: ['Normal', 'Spider'] }],
      decimalProbability: 0.5,
    };
    const normal: GenotypeOutcome = {
      loci: [{ locusId: 'spider_locus', alleles: ['Normal', 'Normal'] }],
      decimalProbability: 0.25,
    };

    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
      dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    });
    const outcomes = aggregateOutcomes([superSpider, het, normal], pair, DICT);

    const lethal = outcomes.find((o) =>
      o.genotype.loci[0].alleles[0] === 'Spider' &&
      o.genotype.loci[0].alleles[1] === 'Spider',
    );
    expect(lethal!.isLethal).toBe(true);
    expect(outcomes.filter((o) => !o.isLethal).every((o) => !o.isLethal)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Congenital warnings
// ---------------------------------------------------------------------------

describe('Congenital warnings from allele defects', () => {
  it('Spider het carries "Neurological Wobble" warning', () => {
    const het: GenotypeOutcome = {
      loci: [{ locusId: 'spider_locus', alleles: ['Normal', 'Spider'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
      dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    });
    const outcomes = aggregateOutcomes([het], pair, DICT);
    expect(outcomes[0].congenitalWarnings).toContain('Neurological Wobble');
  });

  it('Normal animal has no congenital warnings', () => {
    const normal: GenotypeOutcome = {
      loci: [{ locusId: 'spider_locus', alleles: ['Normal', 'Normal'] }],
      decimalProbability: 1.0,
    };
    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
      dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    });
    const outcomes = aggregateOutcomes([normal], pair, DICT);
    expect(outcomes[0].congenitalWarnings).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Output ordering
// ---------------------------------------------------------------------------

describe('Output is sorted by descending probability', () => {
  it('most probable outcome appears first', () => {
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, DICT);

    for (let i = 1; i < outcomes.length; i++) {
      expect(outcomes[i - 1].decimalProbability).toBeGreaterThanOrEqual(
        outcomes[i].decimalProbability,
      );
    }
  });
});
