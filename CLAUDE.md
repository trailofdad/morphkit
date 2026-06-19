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

The pipeline has six layers with strict responsibility boundaries. Data flows left to right — no layer skips or reaches back.

| Layer | Path | Role |
|---|---|---|
| MK-1 | `src/validation/` | Normalizes `MorphkitCalculationInput` → `NormalizedBreedingPair`. Fills implicit single-allele loci to `[allele, "normal"]`; **lowercases every locusId and allele**; injects `["normal", "normal"]` for any locus present on only one parent (locus symmetry). **Dictionary-aware when one is passed** (the pipeline always passes it): resolves allele synonyms/aliases → canonical id, throws `SchemaValidationError` for an unknown locus and `InvalidGenotypeError` for an allele not defined on its locus. Called without a dictionary it is purely structural (unit tests rely on this) |
| MK-2 | `src/engine/` | Cartesian Punnett Matrix — pure root-allele math, outputs `GenotypeOutcome[]`; verifies Hardy-Weinberg sum = 1.0 |
| MK-3/4 | `src/aggregator/` | Translates genotypes → phenotypes, resolves combo names (e.g. "Freeway"), computes `PossibleHet[]`, flags lethality and congenital defects → `AggregatedOutcome[]` |
| MK-5 | `src/worker/` | Web Worker wrapper, message routing, and synchronous pipeline orchestration (`pipeline.ts`); main thread passes the dictionary here as a payload |
| MK-6 | `src/network/` | `syncDictionary` — stale-while-revalidate CDN fetch with a 24-hour `localStorage` cache |

**`src/types.ts` is the single source of truth** for all interfaces and error classes. Never redefine types elsewhere.

### Two inheritance enums (do not conflate)

There are two distinct inheritance unions, and `src/worker/pipeline.ts` (`deriveCdnDictionary`) maps one to the other:

- `InheritanceType` — the **dictionary** vocabulary: `recessive | dominant | incomplete_dominant | polygenic`.
- `InheritancePattern` — the **engine** (`CdnDictionary`) vocabulary: `recessive | dominant | co-dominant | sex-linked`.

The engine uses `InheritancePattern` only to detect sex-linked loci (`incomplete_dominant` → `co-dominant`, `polygenic` → `recessive`). Visual/het resolution in the aggregator keys off the original dictionary `InheritanceType` instead.

### Sex-linked contract: the XX/XY model

Sex-linked loci (`isSexLinked: true`) are modeled on the ball python's XX(♀)/XY(♂) system in `buildSexLinkedMatrix`. **Offspring sex is set by which sex chromosome the male contributes** — Y → son, X → daughter — independent of the morph, so every cross has a 1:1 baseline sex ratio. A mutant allele reaches an offspring through whichever sex chromosome (from either parent) carries it.

Which sex chromosome a *male's* mutant rides is a per-animal fact, not a dictionary property (the same `banana` allele is Male-Maker on the Y or Female-Maker on the X). The input conveys it via the optional `sexChromosomes` array on `LocusInput`, aligned to `alleles` order; when omitted, a male's mutant defaults to the **Y (Male-Maker)**. There is no `_malemaker` id-suffix convention anymore — the dictionary's sex-linked alleles are plain (e.g. `banana`).

### Possible-het input and shed testing (`pos_het`)

A `LocusInput` may carry a `zygosity` of `'het'` (a proven heterozygote → `[allele, normal]`) or `'pos_het'` (an unproven carrier). MK-1 tags a `pos_het` locus with a `carrierProbability` (default `0.5`); the pipeline (`runCalculationPipeline`) then expands each `pos_het` locus into a carrier branch (weight `p`) and a non-carrier branch (weight `1 − p`), runs MK-2 on every combination, and merges the weighted genotype distributions before aggregation. **MK-2 and MK-3/4 run unchanged** — the expansion lives entirely in the pipeline. This is the shed-testing workflow: a DNA-proven positive collapses to `'het'`, a proven negative is expressed by omitting the locus.

### Behaviors UI consumers rely on

- **`comboName` is rarely undefined.** If no registered `ComboDefinition` matches, the aggregator falls back to the joined `phenotypeNames`; it is undefined only for all-Normal outcomes.
- **Lethal outcomes are not removed or re-normalized.** `isLethal` flags the outcome, but it stays in `outcomes[]` and still counts toward the 100%. A UI must filter and re-normalize itself for hatch-only percentages.
- **`calculationMode: 'diagnostic'` and `polygenics` validation are reserved.** `diagnostic` is normalized but never branched on; input `polygenics` are deduplicated and passed through but never validated against `dictionary.polygenicTags`.

## Non-Negotiable Rules

**Web Worker boundary** — `src/engine/` and `src/aggregator/` must never reference `window`, `document`, DOM APIs, or make network requests (`fetch`, `axios`). The main thread fetches external data and passes it into the worker.

**Hardy-Weinberg validation** — before returning from any Punnett matrix function, sum all `decimalProbability` values. If the sum `!== 1.0`, throw `CartesianMatrixError`. No exceptions.

**Loci arrays are always length 2** after MK-1. A locus with **more than 2** input alleles throws `InvalidGenotypeError`; a locus with **0** alleles throws `SchemaValidationError`; exactly 1 is normalized to `[allele, "normal"]`.

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
| `SchemaValidationError(message, field?)` | Input payload fails schema validation — bad shape, missing/invalid `sex`, or a locus with 0 alleles (MK-1) |
| `InvalidGenotypeError(message, locusId?)` | Locus array has more than 2 alleles (MK-1) |
| `CartesianMatrixError(message, actualSum?)` | Probability sum ≠ 1.0 (MK-2) |
| `DictionaryNetworkError(message, cause?)` | CDN fetch fails with no local cache to fall back to (MK-6) |

## Biological Edge Cases

- **Sex-linked loci** (e.g. Banana/Coral Glow): abandon independent assortment; offspring sex comes from the male's X/Y contribution, and the mutant follows whichever sex chromosome carries it (see the XX/XY contract above). Requires `sex` to be present on both animals in the input.
- **Embryonic lethality** (e.g. Homozygous Spider, Super Champagne): MK-2 calculates normally; MK-3/4 sets `isLethal: true` on the `AggregatedOutcome`.
- **Congenital defects / epistasis** (e.g. Black Head Spider): the phenotype label reflects the visual morph, but `congenitalWarnings` must still contain the underlying defect (e.g. `"Neurological Wobble"`).

## Simple API name-resolution contract (planned)

Morphkit exposes two input tiers (see README → "API tiers"). The **complex** tier — explicit `{ locusId, alleles: [a, b] }` — exists today and is the canonical RGI-accurate form. The **simple** tier is an agreed design, **not yet implemented**. When building it, follow these rules:

**Architectural rule — desugar, don't fork.** The simple resolver is a thin front-end that converts a per-parent morph-name list into a standard `MorphkitCalculationInput` (complex form) and then runs the existing MK-1 → MK-2 → MK-3/4 pipeline **unchanged**. It must not contain its own Punnett or aggregation logic. Suggested placement: a new pre-MK-1 layer (e.g. `src/simple/`) whose output is `{ input: MorphkitCalculationInput, warnings: MorphResolution[] }`.

**Input shape (simple tier).** Each parent supplies `morphs: string[]` (plus `id`, `sex`, optional `polygenics`) instead of a `genotype`.

**Name → genotype resolution (infer-and-warn).** A bare morph name does not carry zygosity, so resolution is inheritance-aware and case-insensitive:

1. **Prefix parsing first.** `"Het <Name>"` (and `"Possible Het <Name>"` / `"NN% Het <Name>"`) → `[name, "normal"]`. `"Super <Name>"` → `[name, name]`.
2. **Registered combo names.** If the bare name matches a `ComboDefinition.marketName` (e.g. `"Freeway"`), expand to that combo's `requiredGenotype` loci.
3. **Bare allele name**, resolved via its locus's dictionary `inheritance`:
   - `recessive` → `[name, name]` (a recessive is visual only when homozygous).
   - `incomplete_dominant` → `[name, "normal"]` (the het is the base visual; the `Super` form is the distinct homozygote).
   - `dominant` → `[name, "normal"]` (conventional safe default; the homozygous "super" form is visually indistinguishable from het by name alone — attach an informational message).
4. **Merge by locus.** Two morphs resolving to the same locus combine into that locus's two alleles (e.g. `"Yellowbelly"` + `"Asphalt"` → `[yellowbelly, asphalt]`). More than two alleles landing on one locus is an error.

**Ambiguity / warning cases (attach a `message`, exclude unresolved entries from the cross):**
- Name not found as an allele, combo, or with a `Het`/`Super` prefix → `"Unknown morph 'X'"`.
- Name maps to more than one locus/allele → list the candidates and do not guess.
- `Super` applied to a recessive → warn (nonsensical market term); still treat as homozygous.
- `dominant` bare name → informational note that the super form cannot be inferred from the name; defaulting to het.

The resolution result per morph should be a `MorphResolution` (`{ input, locusId?, alleles?, resolved, message? }`) so a UI can surface exactly which inputs were ambiguous.

## Test Environment Note

`jest.config.ts` overrides `lib` to `['ESNext']` (drops `WebWorker`) so tests run cleanly in Node. This means Web Worker–specific globals (`self`, `postMessage`, etc.) will not be available in tests — mock them if needed rather than importing them directly into testable logic.
