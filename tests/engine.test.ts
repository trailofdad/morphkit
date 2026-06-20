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
// AC-2 — Sex-linked inheritance on the XX/XY model (Banana / Coral Glow)
// ---------------------------------------------------------------------------

// Probability that an offspring of the given sex carries `banana` at all.
function bananaProbBySex(outcomes: GenotypeOutcome[], sex: 'male' | 'female'): number {
  return outcomes
    .filter((o) => o.sex === sex)
    .reduce((sum, o) => {
      const locus = o.loci.find((l) => l.locusId === 'banana_locus');
      return sum + (locus?.alleles.includes('banana') ? o.decimalProbability : 0);
    }, 0);
}

function sexTotal(outcomes: GenotypeOutcome[], sex: 'male' | 'female'): number {
  return outcomes.filter((o) => o.sex === sex).reduce((s, o) => s + o.decimalProbability, 0);
}

describe('AC-2a: Male-Maker banana sire × normal dam (default: mutant on the Y)', () => {
  let outcomes: GenotypeOutcome[];
  beforeAll(() => {
    outcomes = computePunnettMatrix(
      makePair({
        sire: {
          id: 'sire', sex: 'male',
          genotype: [{ locusId: 'banana_locus', alleles: ['banana', 'normal'] }],
          polygenics: [],
        },
        dam: {
          id: 'dam', sex: 'female',
          genotype: [{ locusId: 'banana_locus', alleles: ['normal', 'normal'] }],
          polygenics: [],
        },
      }),
      BANANA_DICT,
    );
  });

  it('100% of males are banana, 0% of females are banana', () => {
    expect(bananaProbBySex(outcomes, 'male')).toBe(sexTotal(outcomes, 'male'));
    expect(bananaProbBySex(outcomes, 'female')).toBe(0);
  });

  it('keeps a 1:1 sex ratio and sums to 1.0', () => {
    expect(sexTotal(outcomes, 'male')).toBe(0.5);
    expect(sexTotal(outcomes, 'female')).toBe(0.5);
    expect(outcomes.reduce((s, o) => s + o.decimalProbability, 0)).toBe(1.0);
  });
});

describe('AC-2b: normal male × het female banana — the all-female-clutch bug fix', () => {
  let outcomes: GenotypeOutcome[];
  beforeAll(() => {
    outcomes = computePunnettMatrix(
      makePair({
        sire: {
          id: 'sire', sex: 'male',
          genotype: [{ locusId: 'banana_locus', alleles: ['normal', 'normal'] }],
          polygenics: [],
        },
        dam: {
          id: 'dam', sex: 'female',
          genotype: [{ locusId: 'banana_locus', alleles: ['banana', 'normal'] }],
          polygenics: [],
        },
      }),
      BANANA_DICT,
    );
  });

  it('produces a 1:1 sex ratio (not 100% female)', () => {
    expect(sexTotal(outcomes, 'male')).toBe(0.5);
    expect(sexTotal(outcomes, 'female')).toBe(0.5);
  });

  it('throws ~25% banana of each sex (dam passes her mutant X to half of all offspring)', () => {
    expect(bananaProbBySex(outcomes, 'male')).toBe(0.25);
    expect(bananaProbBySex(outcomes, 'female')).toBe(0.25);
  });
});

describe('AC-2c: Female-Maker banana sire (mutant on the X) × normal dam', () => {
  let outcomes: GenotypeOutcome[];
  beforeAll(() => {
    outcomes = computePunnettMatrix(
      makePair({
        sire: {
          id: 'sire', sex: 'male',
          genotype: [
            { locusId: 'banana_locus', alleles: ['banana', 'normal'], sexChromosomes: ['X', 'Y'] },
          ],
          polygenics: [],
        },
        dam: {
          id: 'dam', sex: 'female',
          genotype: [{ locusId: 'banana_locus', alleles: ['normal', 'normal'] }],
          polygenics: [],
        },
      }),
      BANANA_DICT,
    );
  });

  it('100% of females are banana, 0% of males are banana (mirror of the male-maker)', () => {
    expect(bananaProbBySex(outcomes, 'female')).toBe(sexTotal(outcomes, 'female'));
    expect(bananaProbBySex(outcomes, 'male')).toBe(0);
  });
});

describe('AC-2d: Super Banana male (homozygous) × normal dam', () => {
  it('produces 100% banana offspring across a 1:1 sex ratio', () => {
    const outcomes = computePunnettMatrix(
      makePair({
        sire: {
          id: 'sire', sex: 'male',
          genotype: [{ locusId: 'banana_locus', alleles: ['banana', 'banana'] }],
          polygenics: [],
        },
        dam: {
          id: 'dam', sex: 'female',
          genotype: [{ locusId: 'banana_locus', alleles: ['normal', 'normal'] }],
          polygenics: [],
        },
      }),
      BANANA_DICT,
    );
    const bananaTotal = bananaProbBySex(outcomes, 'male') + bananaProbBySex(outcomes, 'female');
    expect(bananaTotal).toBe(1.0);
    expect(sexTotal(outcomes, 'male')).toBe(0.5);
    expect(sexTotal(outcomes, 'female')).toBe(0.5);
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

  it('tolerates floating-point drift within epsilon (non-dyadic denominators)', () => {
    // 1/3 + 1/3 + 1/3 sums to 0.9999999999999999 in IEEE-754, not exactly 1.0.
    // Exact equality (the old check) threw here; the epsilon tolerance must not.
    const third = 1 / 3;
    const outcomes: GenotypeOutcome[] = [
      { loci: [], decimalProbability: third },
      { loci: [], decimalProbability: third },
      { loci: [], decimalProbability: third },
    ];
    expect(() => validateHardyWeinberg(outcomes)).not.toThrow();
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

// ---------------------------------------------------------------------------
// #14 — per-locus distribution scales to the true output size (no 4ⁿ blowup)
// ---------------------------------------------------------------------------

describe('#14: independent-assortment fold avoids the 4ⁿ intermediate', () => {
  it('a 7-locus het × het cross yields exactly 3⁷ genotypes summing to 1.0', () => {
    const hetLocus = (i: number) => ({ locusId: `locus_${i}`, alleles: ['m' + i, 'normal'] });
    const genotype = Array.from({ length: 7 }, (_, i) => hetLocus(i));
    const pair = makePair({
      sire: { id: 'sire', sex: 'male', genotype, polygenics: [] },
      dam: { id: 'dam', sex: 'female', genotype, polygenics: [] },
    });

    const outcomes = computePunnettMatrix(pair, []);

    // Each het × het locus contributes 3 genotypes; the true joint size is 3⁷,
    // never the 4⁷ raw-gamete table. Reaching this assertion at all proves the
    // fold did not allocate 16 384 intermediates.
    expect(outcomes).toHaveLength(3 ** 7); // 2187
    const sum = outcomes.reduce((acc, o) => acc + o.decimalProbability, 0);
    expect(sum).toBeCloseTo(1.0, 10);
  });
});

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
