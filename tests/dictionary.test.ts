import { createDictionaryIndex } from '../src/dictionary';
import { resolveMorphString } from '../src/simple';
import { mockDictionary } from './__mocks__/mockDictionary';

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

  it('returns empty for a blank string', () => {
    expect(resolveMorphString('   ', mockDictionary)).toEqual({
      genotype: [],
      morphs: [],
      warnings: [],
      unresolved: [],
    });
  });
});
