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

**Pick your entry point first** (all four run the same MK-1 → MK-2 → MK-3/4 pipeline):

- Know each parent's exact genotype? Use the **complex** tier (`{ locusId, alleles: [a, b] }`).
- Only have a list of **morph names** per parent? Use the **simple** tier — `calculateMorphsSimple` (details under [API tiers](#api-tiers-complex-vs-simple)).
- Need it **off the UI thread** (large crosses, recalc on every keystroke without jank)? Use `calculateMorphsAsync` + a bundled worker.
- SSR, a Node script, a test, or a cheap client-side recalc? Use the synchronous `calculateMorphs` — no worker, no `workerUrl` (details under [Synchronous vs. worker](#synchronous-vs-worker)).

The walk-through below uses `calculateMorphsAsync`; swap in `calculateMorphs` for the sync path.

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

#### Synchronous vs. worker

There are two entry points; both run the **same** MK-1 → MK-2 → MK-3/4 pipeline:

| Function | Threading | Use when |
|---|---|---|
| `calculateMorphs(input, dictionary)` | Synchronous, on the calling thread. Returns the output directly and throws typed errors directly. | SSR, Node scripts, unit tests, and lightweight clients — especially cheap recalcs on each keystroke where worker startup would dominate. No `workerUrl` or bundler plumbing. |
| `calculateMorphsAsync(input, dictionary, workerUrl)` | Off the main thread in a Web Worker; returns a `Promise`. | Large multi-gene crosses where you want the computation off the UI thread. Requires a bundled worker (`workerUrl`). |

```ts
import { calculateMorphs } from '@trailofdad/morphkit';

const result = calculateMorphs(input, dictionary); // no Promise, no worker
```

`calculateMorphsAsync` keeps a **persistent worker per `workerUrl`** and reuses it across calls, so rapid successive crosses don't pay repeated worker startup/teardown; several calculations may be in flight on the same worker at once. An idle worker self-terminates after ~30s — or call `disposeWorkers()` to release them eagerly (e.g. on unmount), which also rejects any still-in-flight calculations.

```ts
import { calculateMorphsAsync, disposeWorkers } from '@trailofdad/morphkit';

const workerUrl = new URL('./morphkit.worker.js', import.meta.url);
const a = await calculateMorphsAsync(input, dictionary, workerUrl); // spawns the worker
const b = await calculateMorphsAsync(input2, dictionary, workerUrl); // reuses it
disposeWorkers(); // optional: free the worker now instead of waiting for the idle timeout
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

The top-level result also carries a **`warnings`** array (`CalculationWarning[]`, empty when clean) for non-fatal advisories that don't change the genetic result — for example an additive polygenic tag that isn't in the dictionary's `polygenicTags` (`code: "unknown_polygenic_tag"`). Unlike unknown loci/alleles (which MK-1 throws on), an unknown polygenic tag is passed through and merely flagged here so a UI can surface a likely typo.

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
| **Simple** (available today) | `morphs: string[]` per parent — a flat list of morph names, no second allele required | Lightweight integrations that only know visual/named morphs and want outcomes + percentages |

**The simple tier is a thin front-end, not a second engine.** It desugars a morph-name list into a complex `MorphkitCalculationInput` using the dictionary, then runs the existing MK-1 → MK-2 → MK-3/4 pipeline unchanged. Because a bare morph name does not carry zygosity, the resolver applies inheritance-aware defaults and returns a **warning message** whenever a name is ambiguous or unresolvable (see [CLAUDE.md](./CLAUDE.md#simple-api-name-resolution-contract) for the full contract). For example:

- `"Clown"` (recessive) → `[clown, clown]` — a recessive is only visual when homozygous
- `"Het Clown"` → `[clown, normal]`
- `"Pastel"` (incomplete-dominant) → `[pastel, normal]`; `"Super Pastel"` → `[pastel, pastel]`
- `"Freeway"` (a registered combo) → expands to the combo's `requiredGenotype`
- an unknown name, or one that maps to more than one genotype, is returned with a `message` and excluded from the cross

```ts
import { calculateMorphsSimple } from '@trailofdad/morphkit';

const { output, warnings } = calculateMorphsSimple(
  {
    sire: { id: 'sire', sex: 'male', morphs: ['Pastel', 'Het Clown'] },
    dam: { id: 'dam', sex: 'female', morphs: ['Freeway', 'Possible Het Clown'] },
  },
  dictionary,
);

// `warnings` is one MorphResolution per input morph — inspect `resolved`/`message`
// to surface ambiguous or unknown names. Use `resolveSimpleInput` instead if you
// want the desugared complex input without running the calculation.
```

## Possible hets & shed testing

Each `genotype` locus can declare a carrier `zygosity` instead of spelling out both alleles:

- `{ locusId: 'clown_locus', alleles: ['clown'], zygosity: 'het' }` — a **proven** heterozygote.
- `{ locusId: 'clown_locus', alleles: ['clown'], zygosity: 'pos_het', carrierProbability: 0.66 }` — a **possible het** (unproven carrier). The engine produces the probabilistic offspring distribution weighted by `carrierProbability` (defaults to `0.5`).

This is the shed-testing / qPCR workflow: model an unproven parent as `pos_het`, and when a DNA test comes back, collapse it to `'het'` (proven positive) or drop the locus (proven negative) — no separate "DNA proven" flag needed.

## Calculation modes & visual masking

Two dictionary-driven behaviors affect what `phenotypeNames` you get back. Neither changes the genotype math — both run in the aggregator (MK-3/4).

**`calculationMode` (input field, defaults to `'standard'`).** Controls how polygenic loci surface:

- In `'standard'` mode a `polygenic` locus is treated recessive-like — visual only when homozygous-mutant.
- In `'diagnostic'` mode, a `dictionary.polygenicGroups` entry (e.g. Desert Ghost = `dg_a` / `dg_b` / `dg_c`) suppresses its member loci's individual visuals and emits the group's `visualLabel` only when the group's `causalLocus` is homozygous-mutant. This is the RGI-style diagnostic split; most consumer UIs can leave the default.

> The separate additive `polygenics: string[]` field is independent of mode — it is deduplicated across both parents and passed through onto every outcome. An additive tag that isn't in `dictionary.polygenicTags` is surfaced via the `warnings` channel (`code: "unknown_polygenic_tag"`), never dropped or thrown.

**Epistatic masking (`dictionary.epistasisRules`).** After collecting per-locus visuals, the aggregator applies masking rules that rewrite **only** `phenotypeNames` — the genotype, `possibleHets`, and `congenitalWarnings` are untouched, so downstream crosses and defect flags stay correct. For example, a Blue-Eyed Leucistic super reports the solid-white phenotype and suppresses unlinked visuals; a Black Head Spider reads "near-normal" while still carrying its `"Neurological Wobble"` warning. A UI renders `phenotypeNames`/`comboName` as-is and does not need to implement masking itself.

## Architecture

Data flows through six layers (MK-1 through MK-6) with strict responsibility boundaries. No layer skips or reaches back.

| Layer | Path | Role |
|---|---|---|
| (simple tier) | `src/simple/` | Optional pre-MK-1 front-end: desugars a per-parent morph-name list into a complex `MorphkitCalculationInput`. No genetics logic of its own |
| MK-1 | `src/validation/` | Normalizes raw `MorphkitCalculationInput` → `NormalizedBreedingPair`; lowercases locusIds/alleles; fills implicit single-allele loci to `[allele, "normal"]` |
| MK-2 | `src/engine/` | Cartesian Punnett Matrix — pure allele math, outputs `GenotypeOutcome[]`; verifies Hardy-Weinberg sum = 1.0 |
| MK-3/4 | `src/aggregator/` | Translates genotypes → phenotypes, resolves combo names, computes poss-hets, applies polygenic-group gating and epistatic masking, flags lethality and congenital defects → `AggregatedOutcome[]` |
| MK-5 | `src/worker/` | Web Worker wrapper, message routing, and synchronous pipeline orchestration; main thread fetches the dictionary and passes it as a payload |
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

> **Synonyms.** Many morphs are sold under multiple names (e.g. Toffee = Candy, Lesser = Butter). The dictionary records these via an `aliases` field on each allele. MK-1 resolves a synonym, display name, or short name to its canonical allele id during a calculation ([#7](https://github.com/trailofdad/morphkit/issues/7)), so either the canonical id or any registered alias is accepted in the complex input — and the simple tier resolves names the same way.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
