import { createDictionaryIndex } from '../src/dictionary';
import { resolveMorphString } from '../src/simple';
import { mockDictionary } from './__mocks__/mockDictionary';
import type { MorphkitDictionary } from '../src/types';

describe('createDictionaryIndex', () => {
  const index = createDictionaryIndex(mockDictionary);

  it('resolves an allele by id, display name, and case-insensitively', () => {
    expect(index.resolveNameUnique('clown')?.locusId).toBe('clown_locus');
    expect(index.resolveNameUnique('Clown')?.alleleId).toBe('clown');
    expect(index.resolveNameUnique('CLOWN')?.locusId).toBe('clown_locus');
  });

  it('carries locus metadata on the resolved entry', () => {
    const entry = index.resolveNameUnique('yellowbelly');
    expect(entry).toMatchObject({
      locusId: 'yellowbelly_complex',
      alleleId: 'yellowbelly',
      inheritance: 'incomplete_dominant',
      isSexLinked: false,
    });
  });

  it('returns [] for unknown names and never resolves "normal"', () => {
    expect(index.resolveName('definitely-not-a-morph')).toEqual([]);
    expect(index.resolveName('normal')).toEqual([]);
  });

  it('resolves registered combos by market name, case-insensitively', () => {
    expect(index.resolveCombo('Freeway')?.marketName).toBe('Freeway');
    expect(index.resolveCombo('freeway')?.marketName).toBe('Freeway');
    expect(index.resolveCombo('nope')).toBeUndefined();
  });

  it('reads locus/allele metadata by id', () => {
    expect(index.getInheritance('clown_locus')).toBe('recessive');
    expect(index.getLocusName('yellowbelly_complex')).toBe('Yellowbelly Complex');
    expect(index.getAlleleName('clown_locus', 'clown')).toBe('Clown');
    expect(index.getInheritance('nope')).toBeUndefined();
  });

  it('returns the full allele definition via getAllele', () => {
    expect(index.getAllele('spider_complex', 'spider')).toEqual({
      id: 'spider',
      name: 'Spider',
      defects: ['Neurological Wobble'],
    });
  });

  it('returns undefined from getAllele for an unknown locus or allele', () => {
    expect(index.getAllele('nope_locus', 'clown')).toBeUndefined();
    expect(index.getAllele('clown_locus', 'nope')).toBeUndefined();
  });

  describe('supersededBy', () => {
    // A legacy duplicate of clown_locus that shares the "Clown" name, plus a
    // name only the legacy locus carries.
    const withLegacy: MorphkitDictionary = {
      ...mockDictionary,
      loci: {
        ...mockDictionary.loci,
        legacy_clown_locus: {
          id: 'legacy_clown_locus',
          name: 'Clown (legacy)',
          inheritance: 'recessive',
          isSexLinked: false,
          supersededBy: 'clown_locus',
          alleles: {
            normal: { id: 'normal', name: 'Normal' },
            legacy_clown: { id: 'legacy_clown', name: 'Clown', aliases: ['Old Clown'] },
          },
        },
      },
    };
    const legacyIndex = createDictionaryIndex(withLegacy);

    it('prefers the live locus when a name matches a superseded one too', () => {
      expect(legacyIndex.resolveName('Clown')).toHaveLength(1);
      expect(legacyIndex.resolveNameUnique('Clown')?.locusId).toBe('clown_locus');
    });

    it('still resolves a name only the superseded locus carries', () => {
      expect(legacyIndex.resolveNameUnique('Old Clown')?.locusId).toBe('legacy_clown_locus');
      expect(legacyIndex.resolveNameUnique('legacy_clown')?.locusId).toBe('legacy_clown_locus');
    });
  });
});

describe('resolveMorphString (free-text tier)', () => {
  it('tokenizes a mixed visual + het string into a genotype', () => {
    const { genotype, unresolved } = resolveMorphString('Clown Het Piebald', mockDictionary);
    // "Piebald" is not in the mock dictionary → unresolved; Clown resolves visual.
    expect(genotype).toContainEqual({ locusId: 'clown_locus', alleles: ['clown', 'clown'] });
    expect(unresolved).toContain('Piebald');
  });

  it('expands a combo name inside a free-text string', () => {
    const { genotype } = resolveMorphString('Freeway', mockDictionary);
    expect(genotype).toContainEqual({
      locusId: 'yellowbelly_complex',
      alleles: ['yellowbelly', 'asphalt'],
    });
  });

  it('applies a "Het" prefix to the allele that follows it', () => {
    const { genotype } = resolveMorphString('Het Clown', mockDictionary);
    expect(genotype).toContainEqual({ locusId: 'clown_locus', alleles: ['clown', 'normal'] });
  });

  it('flags an ambiguous "or" string as unresolved rather than guessing', () => {
    const { genotype, unresolved } = resolveMorphString('Yellowbelly or Asphalt', mockDictionary);
    expect(genotype).toEqual([]);
    expect(unresolved).toEqual(['Yellowbelly or Asphalt']);
  });

  describe('possible hets', () => {
    it.each([
      ['66% Het Clown', 0.66],
      ['50% het Clown', 0.5],
    ])('"%s" → pos_het with its carrier probability', (raw, carrierProbability) => {
      expect(resolveMorphString(raw, mockDictionary).genotype).toEqual([
        { locusId: 'clown_locus', alleles: ['clown', 'normal'], zygosity: 'pos_het', carrierProbability },
      ]);
    });

    it.each(['Poss Het Clown', 'Possible Het Clown', 'pos het clown', 'Pos. Het Clown'])(
      '"%s" → pos_het with the default probability',
      (raw) => {
        const { genotype, unresolved } = resolveMorphString(raw, mockDictionary);
        expect(genotype).toEqual([
          { locusId: 'clown_locus', alleles: ['clown', 'normal'], zygosity: 'pos_het' },
        ]);
        expect(unresolved).toEqual([]);
      },
    );

    it('treats "100% Het" as a proven het', () => {
      expect(resolveMorphString('100% Het Clown', mockDictionary).genotype).toEqual([
        { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
      ]);
    });

    it('excludes a possible het that shares a gene with another allele', () => {
      const { genotype, warnings } = resolveMorphString(
        'Yellowbelly 66% Het Asphalt',
        mockDictionary,
      );
      expect(genotype).toEqual([{ locusId: 'yellowbelly_complex', alleles: ['yellowbelly', 'normal'] }]);
      expect(warnings.find((w) => w.input === '66% Het Asphalt')).toMatchObject({ resolved: false });
    });

    it('lets a later definite allele displace an earlier possible het', () => {
      const { genotype, warnings } = resolveMorphString(
        'Poss Het Asphalt Yellowbelly',
        mockDictionary,
        'sire',
        { hetScope: 'next' },
      );
      expect(genotype).toEqual([{ locusId: 'yellowbelly_complex', alleles: ['yellowbelly', 'normal'] }]);
      expect(warnings.find((w) => w.input === 'Poss Het Asphalt')).toMatchObject({ resolved: false });
    });
  });

  describe('hetScope', () => {
    it('persists a het prefix by default ("Dbl Het" style)', () => {
      expect(resolveMorphString('Het Clown Yellowbelly', mockDictionary).morphs).toEqual([
        'Het Clown',
        'Het Yellowbelly',
      ]);
    });

    it("'next' spends a het prefix on the one trait after it", () => {
      const { genotype } = resolveMorphString('het clown spider', mockDictionary, 'sire', {
        hetScope: 'next',
      });
      expect(genotype).toEqual([
        { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
        { locusId: 'spider_complex', alleles: ['spider', 'normal'] },
      ]);
    });

    it("'next' spends the prefix on an unknown trait instead of passing it on", () => {
      // MorphMarket: "het Axanthic (VPI) clown" with VPI unknown must not make Clown het.
      const { genotype, unresolved } = resolveMorphString(
        'het Mystery clown',
        mockDictionary,
        'sire',
        { hetScope: 'next' },
      );
      expect(genotype).toEqual([{ locusId: 'clown_locus', alleles: ['clown', 'clown'] }]);
      expect(unresolved).toEqual(['Mystery']);
    });
  });

  it('returns empty for a blank string', () => {
    expect(resolveMorphString('   ', mockDictionary)).toEqual({
      genotype: [],
      morphs: [],
      warnings: [],
      unresolved: [],
    });
  });
});
