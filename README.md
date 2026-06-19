# morphkit

[![CI](https://img.shields.io/github/actions/workflow/status/trailofdad/morphkit/ci.yml?label=CI&logo=github)](https://github.com/trailofdad/morphkit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@trailofdad/morphkit?logo=npm&logoColor=white)](https://www.npmjs.com/package/@trailofdad/morphkit)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](https://www.npmjs.com/package/@trailofdad/morphkit?activeTab=dependencies)

A modern, open-source genetic calculation engine for ball python morph breeding. 

Looking for a ready-made UI? 
See **[morphkit-ui](https://github.com/trailofdad/morphkit-ui)** — a React component library that wraps morphkit with a complete breeder-facing interface.
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
| `comboName` | Registered market combo name if one matched (e.g. `"Freeway"`); otherwise falls back to the joined `phenotypeNames`. Undefined only for all-Normal outcomes |
| `percentageProbability` | Human-readable probability, e.g. `"25%"` |
| `possibleHets` | Poss-het markers with `probability` and `isGuaranteed` for hidden recessives |
| `isLethal` | `true` for embryonically lethal genotypes (e.g. homozygous Spider). Lethal outcomes are **not** removed from the result and still count toward the 100% — percentages are not re-normalized after flagging |
| `congenitalWarnings` | Defect labels from the dictionary (e.g. `"Neurological Wobble"`) |
| `polygenics` | Deduplicated polygenics from both parents |

### 3. Using the Web Worker (Vite)

For browser apps, Vite can bundle the worker automatically:

```ts
import MorphkitWorker from 'morphkit/worker/morphkit.worker?worker';
// then pass new MorphkitWorker() directly — see example/src/hooks/useMorphkit.ts
```

A minimal reference React integration lives in [`example/`](./example). For a full-featured UI built on morphkit, see **[morphkit-ui](https://github.com/trailofdad/morphkit-ui)** — a React component library that wraps the engine with a complete breeder-facing interface.

## API tiers: complex vs. simple

Morphkit is architected around the **locus + allele** model (built with RGI / shed-test genetics in mind), so the canonical input is *complex*: you declare each locus and both of its alleles explicitly. Not every consumer needs that precision — many UIs only have a list of morph names per parent and just want outcomes and percentages back. To serve both, morphkit exposes two input tiers that resolve to the **same** pipeline.

| Tier | Input shape | When to use |
|---|---|---|
| **Complex** (available today) | `genotype: [{ locusId, alleles: [a, b] }]` — every locus and both alleles stated explicitly | RGI-style apps that track genotypes precisely, including zygosity and het status |
| **Simple** (planned) | `morphs: string[]` per parent — a flat list of morph names, no second allele required | Lightweight integrations that only know visual/named morphs and want outcomes + percentages |

**The simple tier is a thin front-end, not a second engine.** It desugars a morph-name list into a complex `MorphkitCalculationInput` using the dictionary, then runs the existing MK-1 → MK-2 → MK-3/4 pipeline unchanged. Because a bare morph name does not carry zygosity, the resolver applies inheritance-aware defaults and returns a **warning message** whenever a name is ambiguous or unresolvable (see [CLAUDE.md](./CLAUDE.md#simple-api-name-resolution-contract-planned) for the full contract). For example:

- `"Clown"` (recessive) → `[clown, clown]` — a recessive is only visual when homozygous
- `"Het Clown"` → `[clown, normal]`
- `"Pastel"` (incomplete-dominant) → `[pastel, normal]`; `"Super Pastel"` → `[pastel, pastel]`
- `"Freeway"` (a registered combo) → expands to the combo's `requiredGenotype`
- an unknown name, or one that maps to more than one genotype, is returned with a `message` and excluded from the cross

> The simple tier is a documented, agreed design and is **not yet implemented**. Until it ships, use the complex input shown in [Quick Start](#quick-start).

## Architecture

Data flows through six layers (MK-1 through MK-6) with strict responsibility boundaries. No layer skips or reaches back.

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
| `InvalidGenotypeError` | A locus has **more than 2** alleles (0 alleles throws `SchemaValidationError`; a single allele is normalized to `[allele, "Normal"]`) |
| `CartesianMatrixError` | Probability sum ≠ 1.0 (within a small floating-point tolerance) |
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

> **Synonyms.** Many morphs are sold under multiple names (e.g. Toffee = Candy, Lesser = Butter). The dictionary records these via an `aliases` field on each allele. Engine-side alias resolution — collapsing a synonym to its canonical allele during a calculation — is in progress ([#7](https://github.com/trailofdad/morphkit/issues/7)); until it lands, supply the canonical allele id in the complex input.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
