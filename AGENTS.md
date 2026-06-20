# Morphkit AI Agent Context & Ruleset

## 🧬 Project Identity

You are an expert TypeScript Software Engineer and Computational Biologist working on **Morphkit**: a modern, open-source, client-side genetic calculation engine for reptile breeding (specifically Ball Pythons).

Morphkit is designed to run inside a **Browser Web Worker**. It processes quantitative molecular genetics (root alleles) rather than relying on qualitative visual heuristics.

---

## 🛑 The Golden Rules (Non-Negotiable)

### 1. Web Worker Compliance
The core engine (`morphkit/src/engine`) operates strictly inside a Web Worker.
- **DO NOT** use `window`, `document`, or any DOM manipulation APIs.
- **DO NOT** write network requests (`fetch`, `axios`) inside the core math engine. All external data (like the CDN Dictionary) is fetched by the main thread and passed into the worker as a payload.

### 2. Strict Root-Allele Math
- The math engine **does not** know what a "Freeway" or "Puma" is. It only calculates root alleles (e.g., `Yellowbelly`, `Asphalt`, `Spark`).
- Phenotype translation and combo matching only happen in the Aggregation Layer (`MK-3`), *after* the matrix math is complete.

### 3. Mathematical Determinism (Hardy-Weinberg Validation)
- Every Punnett matrix calculation must equal exactly `1.0`.
- Before returning an outcome array, the engine **MUST** sum all `decimalProbability` values.
- If the sum `!== 1.0`, throw a `CartesianMatrixError`. **No exceptions.**

### 4. Pure Functions & Immutability
- The core engine must be comprised of Pure Functions.
- Do **not** mutate the original input payload.
- Always return newly cloned and constructed output objects.

### 5. Strict TypeScript & Schemas
- **Never** use `any`. Use the predefined interfaces (e.g., `NormalizedBreedingPair`, `MorphkitCalculationOutput`).
- All loci arrays in the core engine must explicitly contain exactly 2 alleles (e.g., `["Clown", "Normal"]`).

---

## 🐍 Biological Edge Cases to Remember

When writing calculation logic, you must account for these biological realities:

### Sex Linkage (the XX/XY model)
If a locus is flagged `isSexLinked` (e.g., Banana/Coral Glow), abandon independent assortment for that locus. Offspring **sex is set by which sex chromosome the male contributes** — Y → son, X → daughter — so every cross has a 1:1 baseline sex ratio; the mutant allele reaches an offspring through whichever sex chromosome (from either parent) carries it. Which chromosome a *male's* mutant rides is a per-animal fact supplied by the optional `sexChromosomes` array on `LocusInput` (aligned to `alleles`; defaults to the **Y / Male-Maker** when omitted). There is **no** `_malemaker` id-suffix convention — the dictionary's sex-linked alleles are plain (e.g. `banana`). `sex` must be present on both animals.

### Embryonic Lethality
Combinations like Homozygous Spider or Super Champagne must calculate normally in the math, but must explicitly be flagged with `isLethal: true` in the output. Lethal outcomes are **not** removed or re-normalized — they still count toward the 100%; the UI filters and re-normalizes for hatch-only percentages.

### Congenital Defects
A masked or visible morph must still pass its defect to the `congenitalWarnings` string array, independent of how the visual renders. Example: Spider carries a "Neurological Wobble" warning in every outcome that expresses the `spider` allele.

### Epistatic Visual Masking
The aggregator applies `dictionary.epistasisRules` *after* per-locus visual collection. A rule rewrites **only** `phenotypeNames` — never the genotype or `congenitalWarnings`, so downstream crosses and the wobble flag stay correct. Examples: a BEL-super (homozygous/compound `blue_eyed_lucy_complex`) reports the solid-white phenotype and suppresses unlinked visuals (`suppressAll`); a Black Head Spider compound suppresses both loci's visuals and reads "near-normal" (`suppressLoci`) while still warning about the wobble.

---

## 📂 Architecture Map

| Directory | Module | Responsibility |
|---|---|---|
| `src/simple/` | pre-MK-1 | `resolveSimpleInput` — desugars a per-parent morph-name list into a complex `MorphkitCalculationInput`. Thin front-end only: **no** Punnett or aggregation logic. |
| `src/validation/` | MK-1 | Normalizes payloads to explicit 2-allele loci arrays; lowercases locusIds/alleles; injects `["normal","normal"]` for loci present on only one parent; dictionary-aware allele/alias → canonical-id resolution. |
| `src/engine/` | MK-2 | The Cartesian Punnett Matrix logic — pure independent-assortment fold over per-locus distributions, no phenotype knowledge. |
| `src/aggregator/` | MK-3 & MK-4 | Translates genotypes to phenotypes, resolves combo names, computes Poss-Hets, flags lethality/defects, applies `polygenicGroups` gating (diagnostic mode) and `epistasisRules` visual masking. |
| `src/worker/` | MK-5 | The Web Worker wrapper + `pipeline.ts` orchestration (`pos_het` branch expansion, dictionary→engine inheritance mapping, warnings collection). The persistent **pooled worker** lives in `src/index.ts`. |
| `src/network/` | MK-6 | `syncDictionary` — stale-while-revalidate CDN fetch with a 24-hour `localStorage` cache. |
| `src/types.ts` | Shared | All TypeScript interfaces and error classes. |
| `tests/` | — | Jest test suites, one per module. |

> **Two input tiers (both shipped).** The canonical *complex* input declares each locus + both alleles explicitly (RGI-accurate). The *simple* tier (`src/simple/` — a per-parent morph-name list with infer-and-warn on ambiguity) is a thin pre-MK-1 front-end that desugars names → a complex `MorphkitCalculationInput`, then runs the same MK-1 → MK-2 → MK-3/4 pipeline unchanged. See `CLAUDE.md` → "Simple API name-resolution contract" and "Two inheritance enums (do not conflate)" for the load-bearing contracts.

> **Two inheritance enums — do not conflate.** `InheritanceType` is the **dictionary** vocabulary (`recessive | dominant | incomplete_dominant | polygenic`); `InheritancePattern` is the **engine** vocabulary (`recessive | dominant | co-dominant | sex-linked`). `src/worker/pipeline.ts` maps one to the other. The engine uses `InheritancePattern` only to detect sex-linked loci; visual/het resolution in the aggregator keys off the original `InheritanceType`.

> **Soft warnings channel.** `MorphkitCalculationOutput.warnings` (`readonly CalculationWarning[]`, empty when clean) carries non-fatal advisories the genetic pipeline raises itself — e.g. an additive `polygenics` tag not present in `dictionary.polygenicTags` (`code: 'unknown_polygenic_tag'`). Unknown **loci/alleles** still *throw* in MK-1; an unknown polygenic tag is passed through and merely flagged. Keep this distinct from the simple tier's per-morph `MorphResolution[]` (name-resolution diagnostics).

---

## 🔌 Public Surface (for consumers / UI integrators)

This file is the ruleset for *working on* the engine. If you are **integrating** morphkit into a UI, the canonical guide is [`README.md`](./README.md) → "Quick Start" and "API tiers". The entry points (`src/index.ts`):

| Export | Use |
|---|---|
| `calculateMorphs(input, dictionary)` | Synchronous, on the calling thread — SSR, Node, tests, cheap per-keystroke recalcs. Throws typed errors directly. |
| `calculateMorphsAsync(input, dictionary, workerUrl)` | Off-thread in a **persistent pooled** Web Worker; returns a `Promise`. `disposeWorkers()` releases workers eagerly. |
| `calculateMorphsSimple(input, dictionary)` | Synchronous simple tier — `{ output, warnings }` from a morph-name list. |
| `resolveSimpleInput(input, dictionary)` | Desugar only — returns the complex input + `MorphResolution[]` without calculating. |
| `syncDictionary(url)` | MK-6 dictionary fetch (main thread only). |

Output a UI must respect: `comboName` falls back to joined `phenotypeNames` (undefined only for all-Normal); `isLethal` outcomes stay in `outcomes[]` and still count toward 100% (filter/re-normalize yourself); `warnings[]` is the soft-diagnostics channel; `phenotypeNames` may be rewritten by epistatic masking while `congenitalWarnings` is preserved.

---

## 🛠️ Error Handling

Always throw specific, typed errors rather than generic ones:

| Error Class | When to Throw |
|---|---|
| `SchemaValidationError` | Bad input payload (wrong shape, missing/invalid `sex`, or a locus with 0 alleles). |
| `InvalidGenotypeError` | More than 2 alleles in a locus array. |
| `CartesianMatrixError` | Probability sum does not equal `1.0`. |
| `DictionaryNetworkError` | CDN fetch fails with no local cache to fall back to (MK-6). |

All error classes are defined in `src/types.ts`.

---

## ✅ Acceptance Criteria Checklist (per epic)

Before marking any ticket complete, verify:
- [ ] No `any` types — run `tsc --noEmit`
- [ ] All probabilities sum to `1.0` in unit tests
- [ ] Web Worker compliance — no DOM or `window` references in `src/engine/` or `src/aggregator/`
- [ ] All new functions have corresponding unit tests in `tests/`
- [ ] `npm run test` passes with zero failures
- [ ] `npm run lint` passes with zero errors
