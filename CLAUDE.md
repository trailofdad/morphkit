# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build       # tsc — compile src/ → dist/
npm run test        # jest — run all tests in tests/
npm run lint        # eslint src/**/*.ts
npx tsc --noEmit    # type-check without emitting (use before marking work done)
```

Run a single test file:
```bash
npx jest tests/engine.test.ts
```

## Architecture

The pipeline has five layers with strict responsibility boundaries. Data flows left to right — no layer skips or reaches back.

| Layer | Path | Role |
|---|---|---|
| MK-1 | `src/validation/` | Normalizes `MorphkitCalculationInput` → `NormalizedBreedingPair` (fills implicit single-allele loci to `[allele, "Normal"]`) |
| MK-2 | `src/engine/` | Cartesian Punnett Matrix — pure root-allele math, outputs `GenotypeOutcome[]` |
| MK-3/4 | `src/aggregator/` | Translates genotypes → phenotypes, resolves combo names (e.g. "Freeway"), computes `PossibleHet[]`, flags lethality and congenital defects → `AggregatedOutcome[]` |
| MK-5 | `src/worker/` | Web Worker wrapper and message routing; main thread passes CDN Dictionary here as a payload |

**`src/types.ts` is the single source of truth** for all interfaces and error classes. Never redefine types elsewhere.

## Non-Negotiable Rules

**Web Worker boundary** — `src/engine/` and `src/aggregator/` must never reference `window`, `document`, DOM APIs, or make network requests (`fetch`, `axios`). The main thread fetches external data and passes it into the worker.

**Hardy-Weinberg validation** — before returning from any Punnett matrix function, sum all `decimalProbability` values. If the sum `!== 1.0`, throw `CartesianMatrixError`. No exceptions.

**Loci arrays are always length 2** after MK-1. An array with any other length must throw `InvalidGenotypeError`.

**Pure functions, no mutation** — never mutate the input payload; always return newly constructed output objects.

**No `any`** — enforced by both `tsconfig.json` (`noImplicitAny: true`) and ESLint (`@typescript-eslint/no-explicit-any: error`). Also enforced: `noUnusedLocals`, `noUnusedParameters`, `noImplicitReturns`, and `explicit-function-return-type` (warn).

## Key Types (src/types.ts)

- `MorphkitCalculationInput` → top-level input (sire + dam as `AnimalInput`)
- `NormalizedBreedingPair` → MK-1 output; each `NormalizedLocus` has exactly `[string, string]` alleles
- `GenotypeOutcome` → MK-2 output; includes `decimalProbability` and optional `sex`
- `AggregatedOutcome` → final output per offspring: `phenotypeNames`, `comboName?`, `possibleHets`, `isLethal`, `congenitalWarnings`, `percentageProbability`
- `MorphkitCalculationOutput` → wraps `outcomes[]`, `normalizedInput`, `calculatedAt`

## Typed Errors (src/types.ts)

| Class | When to throw |
|---|---|
| `SchemaValidationError(message, field?)` | Input payload fails schema validation (MK-1) |
| `InvalidGenotypeError(message, geneName?)` | Locus array does not contain exactly 2 alleles |
| `CartesianMatrixError(message, actualSum?)` | Probability sum ≠ 1.0 |

## Biological Edge Cases

- **Sex-linked loci** (e.g. Banana/Coral Glow): abandon independent assortment; map the mutated allele to the correct sex based on the sire's heterogametic passing. Requires `sex` to be present on both animals in the input.
- **Embryonic lethality** (e.g. Homozygous Spider, Super Champagne): MK-2 calculates normally; MK-3/4 sets `isLethal: true` on the `AggregatedOutcome`.
- **Congenital defects / epistasis** (e.g. Black Head Spider): the phenotype label reflects the visual morph, but `congenitalWarnings` must still contain the underlying defect (e.g. `"Neurological Wobble"`).

## Test Environment Note

`jest.config.ts` overrides `lib` to `['ESNext']` (drops `WebWorker`) so tests run cleanly in Node. This means Web Worker–specific globals (`self`, `postMessage`, etc.) will not be available in tests — mock them if needed rather than importing them directly into testable logic.
