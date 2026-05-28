# morphkit

Genetic calculation engine for ball python morph breeding. Given a sire and dam with known genotypes, morphkit computes all possible offspring genotypes, resolves visual phenotypes against a dictionary, and calculates poss-het percentages.

## Architecture

Data flows through five layers with strict responsibility boundaries:

| Layer | Path | Role |
|---|---|---|
| MK-1 | `src/validation/` | Normalizes raw input → `NormalizedBreedingPair` |
| MK-2 | `src/engine/` | Cartesian Punnett Matrix → `GenotypeOutcome[]` |
| MK-3/4 | `src/aggregator/` | Phenotype resolution, poss-het math, combo naming → `AggregatedOutcome[]` |
| MK-5 | `src/worker/` | Web Worker wrapper; main thread passes the CDN Dictionary as a payload |

`src/types.ts` is the single source of truth for all interfaces.

## Usage

```ts
import { normalizeInput } from 'morphkit/validation';
import { computePunnettMatrix } from 'morphkit/engine';
import { aggregateOutcomes } from 'morphkit/aggregator';
import type { MorphkitCalculationInput, MorphkitDictionary } from 'morphkit/types';

const input: MorphkitCalculationInput = {
  sire: {
    id: 'sire',
    sex: 'male',
    genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
    polygenics: [],
  },
  dam: {
    id: 'dam',
    sex: 'female',
    genotype: [{ locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }],
    polygenics: [],
  },
};

const pair = normalizeInput(input);
const genotypes = computePunnettMatrix(pair, cdnDictionary);
const outcomes = aggregateOutcomes(genotypes, pair, morphkitDictionary);
```

Each `AggregatedOutcome` in the result contains:
- `phenotypeNames` — resolved visual trait names (e.g. `["Clown"]`)
- `comboName` — market name if a dictionary combo matched (e.g. `"Freeway"`), otherwise joined trait names
- `possibleHets` — poss-het markers with `probability` and `isGuaranteed` for hidden recessives
- `isLethal` — true for embryonically lethal genotypes (e.g. homozygous Spider)
- `congenitalWarnings` — defect labels from the dictionary (e.g. `"Neurological Wobble"`)
- `polygenics` — deduplicated polygenics from both parents

## Development

```bash
npm install

npm run build       # compile src/ → dist/
npm test            # run all tests
npm run lint        # ESLint
npx tsc --noEmit    # type-check without emitting
```

Run a single test file:

```bash
npx jest tests/engine.test.ts
```

## Dictionary

The `MorphkitDictionary` is fetched by the main thread (MK-5) and passed into the worker. Engine and aggregator layers must never make network requests — they receive the dictionary as a function argument.

```ts
interface MorphkitDictionary {
  version: string;
  lastUpdated: string;
  loci: Record<string, LocusDefinition>;     // O(1) locus lookup
  combos: ComboDefinition[];                 // market combo matching
  lethalCombos: LethalComboDefinition[];     // embryonic lethality triggers
  polygenicTags: string[];                   // valid polygenic trait labels
}
```
