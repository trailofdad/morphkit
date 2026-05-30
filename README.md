# morphkit

[![CI](https://img.shields.io/github/actions/workflow/status/trailofdad/morphkit/ci.yml?label=CI&logo=github)](https://github.com/trailofdad/morphkit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@trailofdad/morphkit?logo=npm&logoColor=white)](https://www.npmjs.com/package/@trailofdad/morphkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@trailofdad/morphkit?activeTab=dependencies)

A modern, open-source genetic calculation engine for ball python morph breeding. Looking for a ready-made UI? See **[morphkit-ui](https://github.com/trailofdad/morphkit-ui)** — a React component library that wraps morphkit with a complete breeder-facing interface.

--- Given a sire and dam with known genotypes, morphkit computes all possible offspring genotypes, resolves visual phenotypes, calculates poss-het percentages, and flags lethality — client-side, with no backend required.

## Why morphkit?

Some morph calculators treat every genetic trait as a simple binary flag. That breaks down in two important ways:

**Allelic complexes.** The Yellowbelly complex contains multiple distinct alleles at the same locus — Yellowbelly, Asphalt, and Ivory — where specific heterozygous pairings produce named market combos (e.g. Yellowbelly + Asphalt = **Freeway**). A calculator that models each morph as an independent true/false check will either miss these interactions entirely or require hard-coded special-casing per combo. Morphkit models alleles as competing occupants of a shared locus, so combo resolution falls out naturally from the genotype — no special cases needed.

**Embryonic lethality.** Certain homozygous genotypes are not viable: a homozygous Spider embryo does not hatch. Legacy calculators typically display these outcomes as normal offspring. Morphkit's aggregator evaluates every outcome against a `lethalCombos` registry and sets `isLethal: true`, so your UI can warn breeders before a pairing happens.

Additionally, morphkit handles sex-linked morphs (Banana / Coral Glow), congenital-defect warnings (e.g. Neurological Wobble from Spider), and a stale-while-revalidate dictionary cache so the trait database stays up to date without slowing down calculations.

## Installation

```bash
npm install @trailofdad/morphkit
```

Morphkit is a pure-computation library with no runtime dependencies. The trait dictionary is fetched from a CDN separately and passed into the engine, keeping the library bundle small and the data independently versioned.

## Quick Start

### 1. Fetch the dictionary

In production, pin to an immutable version tag. jsDelivr permanently caches versioned URLs, so there is no edge-propagation delay. Drive the version from an environment variable so a dictionary update is a config change, not a code deploy:

```ts
import { syncDictionary } from '@trailofdad/morphkit';

const version = process.env.DICTIONARY_VERSION ?? '1.0.0';
const dictionary = await syncDictionary(
  `https://cdn.jsdelivr.net/gh/trailofdad/morphkit-dictionary@${version}/dictionary.json`
);
```

For local development only, `@latest` is fine:

```ts
// DEV ONLY — do not use in production (jsDelivr caches @latest for up to 24 h)
const dictionary = await syncDictionary(
  'https://cdn.jsdelivr.net/gh/trailofdad/morphkit-dictionary@latest/dictionary.json'
);
```

`syncDictionary` uses a stale-while-revalidate `localStorage` cache (24-hour TTL). On a warm cache the call returns synchronously; on a cold start it awaits the CDN fetch. If you are offline with no cache, it throws `DictionaryNetworkError`. See the [dictionary repo](https://github.com/trailofdad/morphkit-dictionary) for current version numbers.

### 2. Run a calculation

The example below pairs two Het Clown animals and returns all possible offspring.

```ts
import { calculateMorphsAsync, syncDictionary } from '@trailofdad/morphkit';
import type { MorphkitCalculationInput } from '@trailofdad/morphkit';

const version = process.env.DICTIONARY_VERSION ?? '1.0.0';
const dictionary = await syncDictionary(
  `https://cdn.jsdelivr.net/gh/trailofdad/morphkit-dictionary@${version}/dictionary.json`
);

const input: MorphkitCalculationInput = {
  sire: {
    id: 'sire-1',
    sex: 'male',
    genotype: [
      { locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }, // het Clown
    ],
    polygenics: [],
  },
  dam: {
    id: 'dam-1',
    sex: 'female',
    genotype: [
      { locusId: 'clown_locus', alleles: ['Clown', 'Normal'] }, // het Clown
    ],
    polygenics: [],
  },
};

// workerUrl points to your bundled morphkit.worker.js
const workerUrl = new URL('./morphkit.worker.js', import.meta.url);

const result = await calculateMorphsAsync(input, dictionary, workerUrl);

for (const outcome of result.outcomes) {
  console.log(
    outcome.percentageProbability,
    outcome.comboName ?? outcome.phenotypeNames.join(' '),
    outcome.possibleHets.map(h => `${Math.round(h.probability * 100)}% pos het ${h.locusId}`),
  );
}

// Output:
// 25%   Clown    []
// 50%   Normal   ["66% pos het clown_locus"]
// 25%   Normal   []
```

Each `AggregatedOutcome` contains:

| Field | Description |
|---|---|
| `phenotypeNames` | Resolved visual trait names, e.g. `["Clown"]` |
| `comboName` | Market combo name if one matched (e.g. `"Freeway"`), otherwise undefined |
| `percentageProbability` | Human-readable probability, e.g. `"25%"` |
| `possibleHets` | Poss-het markers with `probability` and `isGuaranteed` for hidden recessives |
| `isLethal` | `true` for embryonically lethal genotypes (e.g. homozygous Spider) |
| `congenitalWarnings` | Defect labels from the dictionary (e.g. `"Neurological Wobble"`) |
| `polygenics` | Deduplicated polygenics from both parents |

### 3. Using the Web Worker (Vite)

For browser apps, Vite can bundle the worker automatically:

```ts
import MorphkitWorker from 'morphkit/worker/morphkit.worker?worker';
// then pass new MorphkitWorker() directly — see example/src/hooks/useMorphkit.ts
```

A minimal reference React integration lives in [`example/`](./example). For a full-featured UI built on morphkit, see **[morphkit-ui](https://github.com/trailofdad/morphkit-ui)** — a React component library that wraps the engine with a complete breeder-facing interface.

## Architecture

Data flows through five layers with strict responsibility boundaries. No layer skips or reaches back.

| Layer | Path | Role |
|---|---|---|
| MK-1 | `src/validation/` | Normalizes raw `MorphkitCalculationInput` → `NormalizedBreedingPair`; fills implicit single-allele loci to `[allele, "Normal"]` |
| MK-2 | `src/engine/` | Cartesian Punnett Matrix — pure allele math, outputs `GenotypeOutcome[]`; verifies Hardy-Weinberg sum = 1.0 |
| MK-3/4 | `src/aggregator/` | Translates genotypes → phenotypes, resolves combo names, computes poss-hets, flags lethality and congenital defects → `AggregatedOutcome[]` |
| MK-5 | `src/worker/` | Web Worker wrapper and message routing; main thread fetches the dictionary and passes it as a payload |
| MK-6 | `src/network/` | `syncDictionary` — stale-while-revalidate CDN fetch with `localStorage` cache |

`src/types.ts` is the single source of truth for all interfaces and error classes.

### Typed errors

| Class | Thrown when |
|---|---|
| `SchemaValidationError` | Input payload fails schema validation (MK-1) |
| `InvalidGenotypeError` | Locus array does not contain exactly 2 alleles |
| `CartesianMatrixError` | Probability sum ≠ 1.0 |
| `DictionaryNetworkError` | CDN fetch fails with no local cache to fall back to |

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

The `MorphkitDictionary` is maintained in a separate repository:
**[trailofdad/morphkit-dictionary](https://github.com/trailofdad/morphkit-dictionary)**

If you want to add a new morph, fix an allele name, or register a combo or lethal combination, contributions belong there — not in this repo. See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full split.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
