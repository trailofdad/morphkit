import type { MorphkitDictionary } from '../../src/types';

export const mockDictionary: MorphkitDictionary = {
  version: '1.0.0-mock',
  lastUpdated: '2026-05-28T00:00:00Z',
  polygenicTags: ['Jungle', 'Black Back'],

  loci: {
    clown_locus: {
      id: 'clown_locus',
      name: 'Clown',
      inheritance: 'recessive',
      isSexLinked: false,
      alleles: {
        normal: { id: 'normal', name: 'Normal' },
        clown: { id: 'clown', name: 'Clown' },
      },
    },
    yellowbelly_complex: {
      id: 'yellowbelly_complex',
      name: 'Yellowbelly Complex',
      inheritance: 'incomplete_dominant',
      isSexLinked: false,
      alleles: {
        normal: { id: 'normal', name: 'Normal' },
        yellowbelly: { id: 'yellowbelly', name: 'Yellowbelly' },
        asphalt: { id: 'asphalt', name: 'Asphalt' },
      },
    },
    spider_complex: {
      id: 'spider_complex',
      name: 'Spider',
      inheritance: 'dominant',
      isSexLinked: false,
      alleles: {
        normal: { id: 'normal', name: 'Normal' },
        spider: {
          id: 'spider',
          name: 'Spider',
          defects: ['Neurological Wobble'],
        },
      },
    },
    black_head_complex: {
      id: 'black_head_complex',
      name: 'Black Head',
      inheritance: 'incomplete_dominant',
      isSexLinked: false,
      alleles: {
        normal: { id: 'normal', name: 'Normal' },
        black_head: { id: 'black_head', name: 'Black Head' },
      },
    },
  },

  combos: [
    {
      marketName: 'Freeway',
      requiredGenotype: {
        yellowbelly_complex: ['yellowbelly', 'asphalt'],
      },
    },
    {
      marketName: 'Ivory',
      requiredGenotype: {
        yellowbelly_complex: ['yellowbelly', 'yellowbelly'],
      },
    },
    {
      marketName: 'Super Black Head',
      requiredGenotype: {
        black_head_complex: ['black_head', 'black_head'],
      },
    },
  ],

  lethalCombos: [
    {
      triggerGenotype: {
        spider_complex: ['spider', 'spider'],
      },
    },
  ],
};
