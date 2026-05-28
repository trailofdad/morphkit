import { computePunnettMatrix, validateHardyWeinberg } from '../src/engine';
import { normalizeInput } from '../src/validation';
import {
  CartesianMatrixError,
  CdnDictionary,
  GenotypeOutcome,
  MorphkitCalculationInput,
} from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BANANA_DICT: CdnDictionary = [
  { locusId: 'banana_locus', inheritancePattern: 'sex-linked' },
];

function makePair(overrides: Partial<MorphkitCalculationInput> = {}) {
  return normalizeInput({
    sire: { id: 'sire', sex: 'male', genotype: [], polygenics: [] },
    dam: { id: 'dam', sex: 'female', genotype: [], polygenics: [] },
    ...overrides,
  });
}

function probabilityOf(outcomes: GenotypeOutcome[], locusId: string, alleles: [string, string]): number {
  return outcomes
    .filter((o) => {
      const locus = o.loci.find((l) => l.locusId === locusId);
      if (!locus) return false;
      const [a, b] = alleles;
      return (
        (locus.alleles[0] === a && locus.alleles[1] === b) ||
        (locus.alleles[0] === b && locus.alleles[1] === a)
      );
    })
    .reduce((sum, o) => sum + o.decimalProbability, 0);
}

// ---------------------------------------------------------------------------
// AC-1 — Single-gene het × het (REQ-2.1, REQ-2.4, REQ-2.5)
// ---------------------------------------------------------------------------

describe('AC-1: het clown sire × het clown dam', () => {
  let outcomes: GenotypeOutcome[];

  beforeAll(() => {
    const pair = makePair({
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
    });
    outcomes = computePunnettMatrix(pair, []);
  });

  it('produces exactly 3 unique genotypes after deduplication', () => {
    expect(outcomes).toHaveLength(3);
  });

  it('homozygous clown has decimalProbability 0.25', () => {
    expect(probabilityOf(outcomes, 'clown_locus', ['clown', 'clown'])).toBe(0.25);
  });

  it('heterozygous clown has decimalProbability 0.50', () => {
    expect(probabilityOf(outcomes, 'clown_locus', ['clown', 'normal'])).toBe(0.5);
  });

  it('wild-type normal has decimalProbability 0.25', () => {
    expect(probabilityOf(outcomes, 'clown_locus', ['normal', 'normal'])).toBe(0.25);
  });

  it('probabilities sum to exactly 1.0', () => {
    const sum = outcomes.reduce((acc, o) => acc + o.decimalProbability, 0);
    expect(sum).toBe(1.0);
  });

  it('no outcome carries a sex assignment for a standard locus', () => {
    expect(outcomes.every((o) => o.sex === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-2 — Sex-linked Male-Maker sire × Normal dam (REQ-2.2)
// ---------------------------------------------------------------------------

describe('AC-2: banana_malemaker sire × normal dam (sex-linked)', () => {
  let outcomes: GenotypeOutcome[];

  beforeAll(() => {
    const pair = makePair({
      sire: {
        id: 'sire',
        sex: 'male',
        genotype: [{ locusId: 'banana_locus', alleles: ['banana_malemaker', 'normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam',
        sex: 'female',
        genotype: [{ locusId: 'banana_locus', alleles: ['normal', 'normal'] }],
        polygenics: [],
      },
    });
    outcomes = computePunnettMatrix(pair, BANANA_DICT);
  });

  it('produces exactly 2 unique genotypes (one per sex)', () => {
    expect(outcomes).toHaveLength(2);
  });

  it('100% of male offspring carry banana_malemaker', () => {
    const maleOutcomes = outcomes.filter((o) => o.sex === 'male');
    expect(maleOutcomes.length).toBeGreaterThan(0);
    const maleBananaProbability = maleOutcomes.reduce((sum, o) => {
      const locus = o.loci.find((l) => l.locusId === 'banana_locus');
      const hasBanana = locus?.alleles.includes('banana_malemaker') ?? false;
      return sum + (hasBanana ? o.decimalProbability : 0);
    }, 0);
    const totalMaleProbability = maleOutcomes.reduce((sum, o) => sum + o.decimalProbability, 0);
    expect(maleBananaProbability).toBe(totalMaleProbability);
  });

  it('0% of female offspring carry banana_malemaker', () => {
    const femaleOutcomes = outcomes.filter((o) => o.sex === 'female');
    expect(femaleOutcomes.length).toBeGreaterThan(0);
    const femaleBananaProbability = femaleOutcomes.reduce((sum, o) => {
      const locus = o.loci.find((l) => l.locusId === 'banana_locus');
      const hasBanana = locus?.alleles.includes('banana_malemaker') ?? false;
      return sum + (hasBanana ? o.decimalProbability : 0);
    }, 0);
    expect(femaleBananaProbability).toBe(0);
  });

  it('50% of offspring are male, 50% are female', () => {
    const maleTotal = outcomes
      .filter((o) => o.sex === 'male')
      .reduce((sum, o) => sum + o.decimalProbability, 0);
    const femaleTotal = outcomes
      .filter((o) => o.sex === 'female')
      .reduce((sum, o) => sum + o.decimalProbability, 0);
    expect(maleTotal).toBe(0.5);
    expect(femaleTotal).toBe(0.5);
  });

  it('all outcomes have an explicit sex assignment', () => {
    expect(outcomes.every((o) => o.sex !== undefined)).toBe(true);
  });

  it('probabilities sum to exactly 1.0', () => {
    const sum = outcomes.reduce((acc, o) => acc + o.decimalProbability, 0);
    expect(sum).toBe(1.0);
  });
});

// ---------------------------------------------------------------------------
// AC-3 — Hardy-Weinberg validation (REQ-2.6)
// ---------------------------------------------------------------------------

describe('AC-3: Hardy-Weinberg validation', () => {
  it('throws CartesianMatrixError when probability sum is 0.999998', () => {
    const badOutcomes: GenotypeOutcome[] = [
      { loci: [], decimalProbability: 0.499999 },
      { loci: [], decimalProbability: 0.499999 },
    ];
    expect(() => validateHardyWeinberg(badOutcomes)).toThrow(CartesianMatrixError);
  });

  it('carries the actual sum on CartesianMatrixError.actualSum', () => {
    const badOutcomes: GenotypeOutcome[] = [
      { loci: [], decimalProbability: 0.499999 },
      { loci: [], decimalProbability: 0.499999 },
    ];
    try {
      validateHardyWeinberg(badOutcomes);
      fail('expected CartesianMatrixError');
    } catch (err) {
      expect(err).toBeInstanceOf(CartesianMatrixError);
      expect((err as CartesianMatrixError).actualSum).toBeCloseTo(0.999998, 5);
    }
  });

  it('does not throw for a valid 1.0 sum', () => {
    const good: GenotypeOutcome[] = [
      { loci: [], decimalProbability: 0.25 },
      { loci: [], decimalProbability: 0.5 },
      { loci: [], decimalProbability: 0.25 },
    ];
    expect(() => validateHardyWeinberg(good)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// REQ-2.3 — Global Cartesian product (multi-locus)
// ---------------------------------------------------------------------------

describe('REQ-2.3: multi-locus Cartesian product', () => {
  it('two homozygous loci produce a single outcome at probability 1.0', () => {
    const pair = makePair({
      sire: {
        id: 'sire',
        sex: 'male',
        genotype: [
          { locusId: 'clown_locus', alleles: ['clown', 'clown'] },
          { locusId: 'pastel_locus', alleles: ['pastel', 'pastel'] },
        ],
        polygenics: [],
      },
      dam: {
        id: 'dam',
        sex: 'female',
        genotype: [
          { locusId: 'clown_locus', alleles: ['clown', 'clown'] },
          { locusId: 'pastel_locus', alleles: ['pastel', 'pastel'] },
        ],
        polygenics: [],
      },
    });
    const outcomes = computePunnettMatrix(pair, []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].decimalProbability).toBe(1.0);
  });

  it('two independent het loci produce 9 unique genotypes', () => {
    const pair = makePair({
      sire: {
        id: 'sire',
        sex: 'male',
        genotype: [
          { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
          { locusId: 'spider_complex', alleles: ['spider', 'normal'] },
        ],
        polygenics: [],
      },
      dam: {
        id: 'dam',
        sex: 'female',
        genotype: [
          { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
          { locusId: 'spider_complex', alleles: ['spider', 'normal'] },
        ],
        polygenics: [],
      },
    });
    const outcomes = computePunnettMatrix(pair, []);
    expect(outcomes).toHaveLength(9);
    const sum = outcomes.reduce((acc, o) => acc + o.decimalProbability, 0);
    expect(sum).toBe(1.0);
  });

  it('preserves all locusIds on each outcome', () => {
    const pair = makePair({
      sire: {
        id: 'sire',
        sex: 'male',
        genotype: [
          { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
          { locusId: 'pastel_locus', alleles: ['pastel', 'normal'] },
        ],
        polygenics: [],
      },
      dam: {
        id: 'dam',
        sex: 'female',
        genotype: [
          { locusId: 'clown_locus', alleles: ['normal', 'normal'] },
          { locusId: 'pastel_locus', alleles: ['normal', 'normal'] },
        ],
        polygenics: [],
      },
    });
    const outcomes = computePunnettMatrix(pair, []);
    for (const outcome of outcomes) {
      const ids = outcome.loci.map((l) => l.locusId);
      expect(ids).toContain('clown_locus');
      expect(ids).toContain('pastel_locus');
    }
  });
});

// ---------------------------------------------------------------------------
// REQ-2.4 — Allele sorting for canonical deduplication
// ---------------------------------------------------------------------------

describe('REQ-2.4: canonical allele sorting', () => {
  it('treats [a, b] and [b, a] as the same genotype', () => {
    const pair = makePair({
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
    });
    const outcomes = computePunnettMatrix(pair, []);
    const hetCount = outcomes.filter((o) => {
      const a = o.loci[0].alleles;
      return (a[0] === 'clown' && a[1] === 'normal') || (a[0] === 'normal' && a[1] === 'clown');
    }).length;
    expect(hetCount).toBe(1);
    expect(probabilityOf(outcomes, 'clown_locus', ['clown', 'normal'])).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('both animals homozygous normal produces one outcome at 1.0', () => {
    const pair = makePair({
      sire: {
        id: 'sire',
        sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['normal', 'normal'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam',
        sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['normal', 'normal'] }],
        polygenics: [],
      },
    });
    const outcomes = computePunnettMatrix(pair, []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].decimalProbability).toBe(1.0);
    expect(outcomes[0].loci[0].alleles).toEqual(['normal', 'normal']);
  });

  it('homozygous sire × homozygous dam (different alleles) produces one outcome at 1.0', () => {
    const pair = makePair({
      sire: {
        id: 'sire',
        sex: 'male',
        genotype: [{ locusId: 'clown_locus', alleles: ['clown', 'clown'] }],
        polygenics: [],
      },
      dam: {
        id: 'dam',
        sex: 'female',
        genotype: [{ locusId: 'clown_locus', alleles: ['normal', 'normal'] }],
        polygenics: [],
      },
    });
    const outcomes = computePunnettMatrix(pair, []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].decimalProbability).toBe(1.0);
    expect(outcomes[0].loci[0].alleles).toEqual(['clown', 'normal']);
  });

  it('empty genotype produces a single outcome at probability 1.0', () => {
    const pair = makePair();
    const outcomes = computePunnettMatrix(pair, []);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].decimalProbability).toBe(1.0);
  });
});
