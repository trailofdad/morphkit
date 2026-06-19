import { aggregateOutcomes } from '../src/aggregator';
import { computePunnettMatrix } from '../src/engine';
import { normalizeInput } from '../src/validation';
import {
  AggregatedOutcome,
  GenotypeOutcome,
  MorphkitCalculationInput,
  MorphkitDictionary,
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
// Poss-het: independent assortment — multi-locus cross must not dilute poss-het %
// ---------------------------------------------------------------------------

describe('independent assortment — poss-het % is locus-isolated, not diluted by extra loci', () => {
  it('het clown × normal with a co-dominant locus: every carrier card shows 50%, not 25%', () => {
    // Two loci: yellowbelly (incomplete_dominant) + clown (recessive).
    // Sire: yellowbelly/normal + clown/normal.  Dam: normal/normal + normal/normal.
    // At clown_locus alone: 50% carrier, 50% clear → poss-het should be 50% on every carrier card.
    // The co-dominant yellowbelly locus must not reduce the displayed poss-het value.
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [
          { locusId: 'yellowbelly_complex', alleles: ['yellowbelly', 'normal'] },
          { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
        ],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [
          { locusId: 'yellowbelly_complex', alleles: ['normal', 'normal'] },
          { locusId: 'clown_locus', alleles: ['normal', 'normal'] },
        ],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    const carrierOutcomes = outcomes.filter((o) => {
      const cl = o.genotype.loci.find((l) => l.locusId === 'clown_locus');
      return cl && cl.alleles.includes('clown') && !o.phenotypeNames.includes('Clown');
    });

    expect(carrierOutcomes.length).toBeGreaterThan(0);
    for (const outcome of carrierOutcomes) {
      const possHet = outcome.possibleHets.find((p) => p.locusId === 'clown_locus');
      expect(possHet).toBeDefined();
      // Must be 50% regardless of yellowbelly trait — independent assortment.
      expect(possHet!.probability).toBe(0.5);
    }
  });

  it('guaranteed het is preserved across multi-locus cross (visual clown dam × het clown sire)', () => {
    // At clown_locus: sire clown/normal × dam clown/clown → all non-visual are guaranteed hets.
    // Adding a co-dominant locus must not break the 100% / isGuaranteed: true result.
    const pair = makePair({
      sire: {
        id: 'sire', sex: 'male',
        genotype: [
          { locusId: 'yellowbelly_complex', alleles: ['yellowbelly', 'normal'] },
          { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
        ],
        polygenics: [],
      },
      dam: {
        id: 'dam', sex: 'female',
        genotype: [
          { locusId: 'yellowbelly_complex', alleles: ['normal', 'normal'] },
          { locusId: 'clown_locus', alleles: ['clown', 'clown'] },
        ],
        polygenics: [],
      },
    });
    const genotypes = computePunnettMatrix(pair, []);
    const outcomes = aggregateOutcomes(genotypes, pair, mockDictionary);

    const carrierOutcomes = outcomes.filter((o) => {
      const cl = o.genotype.loci.find((l) => l.locusId === 'clown_locus');
      return cl && cl.alleles.includes('clown') && !o.phenotypeNames.includes('Clown');
    });

    expect(carrierOutcomes.length).toBeGreaterThan(0);
    for (const outcome of carrierOutcomes) {
      const possHet = outcome.possibleHets.find((p) => p.locusId === 'clown_locus');
      expect(possHet).toBeDefined();
      expect(possHet!.probability).toBe(1.0);
      expect(possHet!.isGuaranteed).toBe(true);
    }
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

// ---------------------------------------------------------------------------
// REQ-8: incomplete-dominant Super tier
// ---------------------------------------------------------------------------

describe('REQ-8: incomplete-dominant Super tier', () => {
  function single(locusId: string, alleles: [string, string]): AggregatedOutcome {
    const g: GenotypeOutcome = { loci: [{ locusId, alleles }], decimalProbability: 1.0 };
    return aggregateOutcomes([g], makePair(), mockDictionary)[0];
  }

  it('labels a homozygous incomplete-dominant as "Super <name>"', () => {
    const out = single('black_head_complex', ['black_head', 'black_head']);
    expect(out.phenotypeNames).toContain('Super Black Head');
    expect(out.phenotypeNames).not.toContain('Black Head');
  });

  it('labels the single-gene het with the plain name (no Super)', () => {
    expect(single('black_head_complex', ['black_head', 'normal']).phenotypeNames).toEqual([
      'Black Head',
    ]);
  });

  it('does not "Super"-prefix a homozygous recessive — it is simply the visual', () => {
    expect(single('clown_locus', ['clown', 'clown']).phenotypeNames).toEqual(['Clown']);
  });
});

// ---------------------------------------------------------------------------
// REQ-11: zygosity-conditional defects and defect combos
// ---------------------------------------------------------------------------

describe('REQ-11: super-only defects and defect combos', () => {
  const defectDict: MorphkitDictionary = {
    version: '0.0.0-test',
    lastUpdated: '2026-06-19T00:00:00Z',
    polygenicTags: [],
    combos: [],
    lethalCombos: [],
    loci: {
      sable_locus: {
        id: 'sable_locus', name: 'Sable', inheritance: 'incomplete_dominant', isSexLinked: false,
        alleles: {
          normal: { id: 'normal', name: 'Normal' },
          sable: { id: 'sable', name: 'Sable', superDefects: ['Neurological Wobble'] },
        },
      },
      bel_locus: {
        id: 'bel_locus', name: 'BEL', inheritance: 'incomplete_dominant', isSexLinked: false,
        alleles: { normal: { id: 'normal', name: 'Normal' }, lesser: { id: 'lesser', name: 'Lesser' } },
      },
      pied_locus: {
        id: 'pied_locus', name: 'Piebald', inheritance: 'recessive', isSexLinked: false,
        alleles: { normal: { id: 'normal', name: 'Normal' }, pied: { id: 'pied', name: 'Pied' } },
      },
    },
    defectCombos: [
      {
        triggerGenotype: { bel_locus: ['lesser', 'lesser'], pied_locus: ['pied', 'pied'] },
        defects: ['Bug Eyes'],
      },
    ],
  };

  function warningsFor(loci: GenotypeOutcome['loci']): readonly string[] {
    const g: GenotypeOutcome = { loci, decimalProbability: 1.0 };
    return aggregateOutcomes([g], makePair(), defectDict)[0].congenitalWarnings;
  }

  it('does not fire a super-only defect on the single-gene het', () => {
    expect(warningsFor([{ locusId: 'sable_locus', alleles: ['sable', 'normal'] }])).toEqual([]);
  });

  it('fires a super-only defect on the homozygous (super) form', () => {
    expect(warningsFor([{ locusId: 'sable_locus', alleles: ['sable', 'sable'] }])).toContain(
      'Neurological Wobble',
    );
  });

  it('fires a defect combo when the full trigger genotype is present', () => {
    expect(
      warningsFor([
        { locusId: 'bel_locus', alleles: ['lesser', 'lesser'] },
        { locusId: 'pied_locus', alleles: ['pied', 'pied'] },
      ]),
    ).toContain('Bug Eyes');
  });

  it('does not fire the defect combo when only part of the trigger is present', () => {
    expect(
      warningsFor([
        { locusId: 'bel_locus', alleles: ['lesser', 'lesser'] },
        { locusId: 'pied_locus', alleles: ['pied', 'normal'] },
      ]),
    ).not.toContain('Bug Eyes');
  });
});

// ---------------------------------------------------------------------------
// REQ-13: polygenic locus logic (standard) + diagnostic Desert Ghost gate
// ---------------------------------------------------------------------------

describe('REQ-13: polygenic standard heuristic and diagnostic mode', () => {
  const allele = (id: string, name: string) => ({ id, name });
  const dgDict: MorphkitDictionary = {
    version: '0.0.0-test',
    lastUpdated: '2026-06-19T00:00:00Z',
    polygenicTags: [],
    combos: [],
    lethalCombos: [],
    loci: {
      desert_ghost_complex: {
        id: 'desert_ghost_complex', name: 'Desert Ghost',
        inheritance: 'polygenic', isSexLinked: false,
        alleles: { normal: allele('normal', 'Normal'), desert_ghost: allele('desert_ghost', 'Desert Ghost') },
      },
      dg_a: {
        id: 'dg_a', name: 'DG-A', inheritance: 'polygenic', isSexLinked: false,
        alleles: { normal: allele('normal', 'Normal'), dga: allele('dga', 'DG-A') },
      },
      dg_b: {
        id: 'dg_b', name: 'DG-B', inheritance: 'polygenic', isSexLinked: false,
        alleles: { normal: allele('normal', 'Normal'), dgb: allele('dgb', 'DG-B') },
      },
      dg_c: {
        id: 'dg_c', name: 'DG-C', inheritance: 'polygenic', isSexLinked: false,
        alleles: { normal: allele('normal', 'Normal'), dgc: allele('dgc', 'DG-C') },
      },
    },
    polygenicGroups: [
      { name: 'Desert Ghost', loci: ['dg_a', 'dg_b', 'dg_c'], causalLocus: 'dg_c', visualLabel: 'Visual Desert Ghost' },
    ],
  };

  function phenotypes(loci: GenotypeOutcome['loci'], mode: 'standard' | 'diagnostic'): readonly string[] {
    const g: GenotypeOutcome = { loci, decimalProbability: 1.0 };
    return aggregateOutcomes([g], makePair({ calculationMode: mode }), dgDict)[0].phenotypeNames;
  }

  // --- Standard mode: a polygenic locus is recessive-like, NOT dominant ---

  it('standard: homozygous polygenic is visual', () => {
    expect(phenotypes([{ locusId: 'desert_ghost_complex', alleles: ['desert_ghost', 'desert_ghost'] }], 'standard')).toContain(
      'Desert Ghost',
    );
  });

  it('standard: a single-allele polygenic does NOT resolve as a dominant visual', () => {
    expect(phenotypes([{ locusId: 'desert_ghost_complex', alleles: ['desert_ghost', 'normal'] }], 'standard')).toEqual([]);
  });

  // --- Diagnostic mode: visual gated on DGc homozygous ---

  it('diagnostic: DGc homozygous-mutant yields "Visual Desert Ghost"', () => {
    expect(phenotypes([{ locusId: 'dg_c', alleles: ['dgc', 'dgc'] }], 'diagnostic')).toContain(
      'Visual Desert Ghost',
    );
  });

  it('diagnostic: DGc heterozygous is visually normal (gate needs homozygous)', () => {
    expect(phenotypes([{ locusId: 'dg_c', alleles: ['dgc', 'normal'] }], 'diagnostic')).toEqual([]);
  });

  it('diagnostic: DGa / DGb mutations alone read visually normal', () => {
    expect(
      phenotypes(
        [
          { locusId: 'dg_a', alleles: ['dga', 'dga'] },
          { locusId: 'dg_b', alleles: ['dgb', 'dgb'] },
          { locusId: 'dg_c', alleles: ['normal', 'normal'] },
        ],
        'diagnostic',
      ),
    ).toEqual([]);
  });

  it('diagnostic actually changes output vs standard for the same genotype', () => {
    const dgaHomo: GenotypeOutcome['loci'] = [{ locusId: 'dg_a', alleles: ['dga', 'dga'] }];
    // Standard treats DGa as its own recessive-like visual; diagnostic suppresses
    // it (only DGc gates the phenotype).
    expect(phenotypes(dgaHomo, 'standard')).toEqual(['DG-A']);
    expect(phenotypes(dgaHomo, 'diagnostic')).toEqual([]);
  });
});
