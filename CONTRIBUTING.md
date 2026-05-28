# Contributing to Morphkit

Morphkit is split across two repositories with distinct scopes. Before opening a PR, make sure you are in the right place.

## Two repositories, two contribution tracks

| What you want to change | Where to contribute |
|---|---|
| Engine logic, validation, aggregator, worker, network layer, types, tests, tooling | **This repo** — [trailofdad/morphkit](https://github.com/trailofdad/morphkit) |
| Morph definitions, allele names, combo registrations, lethality rules, polygenic tags | **Dictionary repo** — [trailofdad/morphkit-dictionary](https://github.com/trailofdad/morphkit-dictionary) |

The dictionary is a separate JSON data package intentionally decoupled from the engine. This means trait data can be updated and versioned independently without shipping a new engine release. If you are adding or correcting a morph, locus, combo, or lethality entry, the dictionary repo is the right place — changes here to the mock dictionary in `example/src/mockDictionary.ts` or test fixtures do not affect the production trait database.

---

## Code contributions (this repo)

### Setup

```bash
git clone https://github.com/trailofdad/morphkit.git
cd morphkit
npm install
```

Verify everything is green before you start:

```bash
npm test
npx tsc --noEmit
npm run lint
```

### Making a change

1. Fork the repo and create a branch from `main`.
2. Make your change. Keep each PR focused on one concern.
3. Add or update tests in `tests/`. Every new code path needs coverage.
4. Run the full check suite before pushing:

```bash
npm test && npx tsc --noEmit && npm run lint
```

5. Open a pull request against `main` with a clear description of what changed and why.

### Code standards

These are enforced by the compiler and linter and will fail CI if violated:

- **No `any`** — `noImplicitAny` and `@typescript-eslint/no-explicit-any: error` are both on.
- **Pure functions, no mutation** — never mutate an input object; always return newly constructed values.
- **Web Worker boundary** — `src/engine/` and `src/aggregator/` must never reference `window`, `document`, DOM APIs, or `fetch`. The main thread fetches external data and passes it in.
- **Hardy-Weinberg invariant** — any Punnett matrix function must sum all `decimalProbability` values to exactly `1.0` before returning, or throw `CartesianMatrixError`.
- **Loci arrays are always length 2** after MK-1. Any other length must throw `InvalidGenotypeError`.
- **No unused locals, parameters, or implicit returns** — `tsconfig.json` enforces all three.
- **No comments explaining what the code does** — use well-named identifiers. A comment is only warranted when the *why* is non-obvious (a hidden constraint, a biological edge case, a workaround for a specific bug).

### Biological edge cases

If your change touches inheritance math, be aware of the three classes of edge cases the engine must handle:

- **Sex-linked loci** (e.g. Banana / Coral Glow): independent assortment does not apply; the mutated allele maps to sex based on the sire's heterogametic passing. `sex` must be present on both animals in the input.
- **Embryonic lethality** (e.g. Homozygous Spider, Super Champagne): MK-2 calculates the genotype normally; MK-3/4 sets `isLethal: true` on the `AggregatedOutcome`.
- **Congenital defects / epistasis** (e.g. Black Head Spider): the phenotype label reflects the visual morph, but `congenitalWarnings` must contain the underlying defect label (e.g. `"Neurological Wobble"`).

### Test environment note

`jest.config.ts` overrides `lib` to `['ESNext']` (drops `WebWorker`) so tests run cleanly in Node. Web Worker globals (`self`, `postMessage`, etc.) are not available in tests — mock them if needed rather than importing them directly into testable logic.

---

## Data contributions (dictionary repo)

All morph definitions live in **[trailofdad/morphkit-dictionary](https://github.com/trailofdad/morphkit-dictionary)**. That repo's README describes the dictionary schema and contribution process in detail. In short:

- **New morph / locus** — add a `LocusDefinition` entry with correct `inheritance`, `isSexLinked`, and `alleles`.
- **New combo** — add a `ComboDefinition` with the `marketName` and the `requiredGenotype` map.
- **New lethality rule** — add a `LethalComboDefinition` with the `triggerGenotype`.
- **Defect warning** — add the label to the relevant allele's `defects` array.

Changes to the dictionary do not require an engine release. The CDN is updated independently and consumers pick up the new data on their next cache refresh (within 24 hours by default).

---

## Reporting bugs

Open an issue in this repo for engine bugs (wrong probabilities, incorrect phenotype resolution, crashes). Open an issue in the [dictionary repo](https://github.com/trailofdad/morphkit-dictionary) for incorrect morph data (wrong allele name, missing combo, wrong inheritance pattern).

Please include:
- The `MorphkitCalculationInput` JSON that triggers the bug.
- The output you received and the output you expected.
- The dictionary version (from `dictionary.version`) if relevant.
