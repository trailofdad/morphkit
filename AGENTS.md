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

### Sex Linkage
If a locus is flagged as `sex-linked` (e.g., Banana/Coral Glow), abandon independent assortment for that locus and strictly map the mutated allele to the correct sex (`male` or `female`) based on the sire's heterogametic passing.

### Embryonic Lethality
Combinations like Homozygous Spider or Super Champagne must calculate normally in the math, but must explicitly be flagged with `isLethal: true` in the output.

### Congenital Defects (Epistasis)
Masked visual traits must still pass their defects to the `congenitalWarnings` string array. For example: a Black Head Spider looks like a Black Head visually, but must output a "Neurological Wobble" warning.

---

## 📂 Architecture Map

| Directory | Module | Responsibility |
|---|---|---|
| `src/validation/` | MK-1 | Normalizes payloads to explicit 2-allele loci arrays; lowercases locusIds/alleles; injects `["normal","normal"]` for loci present on only one parent. |
| `src/engine/` | MK-2 | The Cartesian Punnett Matrix logic — pure math, no phenotype knowledge. |
| `src/aggregator/` | MK-3 & MK-4 | Translates genotypes to phenotypes, computes Poss-Hets, flags lethality/defects. |
| `src/worker/` | MK-5 | The Web Worker wrapper, event listeners, and synchronous pipeline orchestration. |
| `src/network/` | MK-6 | `syncDictionary` — stale-while-revalidate CDN fetch with a 24-hour `localStorage` cache. |
| `src/types.ts` | Shared | All TypeScript interfaces and error classes. |
| `tests/` | — | Jest test suites, one per module. |

> **Two input tiers.** The canonical *complex* input declares each locus + both alleles explicitly (RGI-accurate). A *simple* tier (morph-name list per parent, infer-and-warn on ambiguity) is an agreed but **not-yet-implemented** design — see `CLAUDE.md` → "Simple API name-resolution contract" and "Two inheritance enums" / "`_malemaker` suffix" for the load-bearing contracts.

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
