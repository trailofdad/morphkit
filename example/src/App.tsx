import { useState, useEffect } from 'react';
import { useMorphkit } from './hooks/useMorphkit';
import { syncDictionary } from '../../src/network';
import { OutcomeCard } from './components/OutcomeCard';
import type { AggregatedOutcome, MorphkitCalculationInput, MorphkitDictionary } from '../../src/types';
import './App.css';

// ♂ Freeway Spider Het-Clown  ×  ♀ Spider Clown Black Head
// Demonstrates: lethal Super Spider, congenital warnings, combo names,
// poss-het math, and dominant/incomplete-dominant/recessive phenotypes.
const TEST_INPUT: MorphkitCalculationInput = {
  calculationMode: 'standard',
  sire: {
    id: 'sire',
    sex: 'male',
    genotype: [
      { locusId: 'yellowbelly_complex', alleles: ['yellowbelly', 'asphalt'] },
      { locusId: 'spider_complex', alleles: ['spider', 'normal'] },
      { locusId: 'clown_locus', alleles: ['clown', 'normal'] },
      { locusId: 'black_head_complex', alleles: ['normal', 'normal'] },
    ],
    polygenics: [],
  },
  dam: {
    id: 'dam',
    sex: 'female',
    genotype: [
      { locusId: 'yellowbelly_complex', alleles: ['normal', 'normal'] },
      { locusId: 'spider_complex', alleles: ['spider', 'normal'] },
      { locusId: 'clown_locus', alleles: ['clown', 'clown'] },
      { locusId: 'black_head_complex', alleles: ['black_head', 'normal'] },
    ],
    polygenics: ['Jungle'],
  },
};

export default function App(): JSX.Element {
  const { calculateMorphsAsync, isCalculating, error } = useMorphkit();
  const [dictionary, setDictionary] = useState<MorphkitDictionary | null>(null);
  const [dictionaryError, setDictionaryError] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<readonly AggregatedOutcome[] | null>(null);
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null);

  useEffect(() => {
    syncDictionary(import.meta.env.VITE_DICTIONARY_URL)
      .then(setDictionary)
      .catch((err: unknown) => setDictionaryError((err as Error).message));
  }, []);

  const handleCalculate = async (): Promise<void> => {
    if (!dictionary) return;
    const result = await calculateMorphsAsync(TEST_INPUT, dictionary);
    setOutcomes(result.outcomes);
    setCalculatedAt(result.calculatedAt);
  };

  const lethalCount = outcomes?.filter((o) => o.isLethal).length ?? 0;
  const viableCount = (outcomes?.length ?? 0) - lethalCount;

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Morphkit</h1>
        <p className="app__subtitle">Reference Implementation — MK-7</p>
      </header>

      <main className="app__main">
        <section className="pairing-card">
          <div className="pairing-card__animals">
            <div className="pairing-card__animal">
              <span className="pairing-card__sex">♂</span>
              <div>
                <div className="pairing-card__animal-name">Freeway Spider Het-Clown</div>
                <div className="pairing-card__genes">
                  Yellowbelly + Asphalt · Spider · Het Clown
                </div>
              </div>
            </div>
            <span className="pairing-card__cross">×</span>
            <div className="pairing-card__animal">
              <span className="pairing-card__sex">♀</span>
              <div>
                <div className="pairing-card__animal-name">Spider Clown Black Head</div>
                <div className="pairing-card__genes">
                  Spider · Visual Clown · Black Head · Jungle (polygenic)
                </div>
              </div>
            </div>
          </div>

          <button
            className="pairing-card__btn"
            onClick={() => void handleCalculate()}
            disabled={isCalculating || !dictionary}
          >
            {isCalculating ? 'Calculating…' : dictionary ? 'Calculate' : 'Loading dictionary…'}
          </button>

          {dictionaryError && <p className="pairing-card__error">Dictionary error: {dictionaryError}</p>}
          {error && <p className="pairing-card__error">{error}</p>}
        </section>

        {outcomes && (
          <>
            <div className="results-meta">
              <span>{outcomes.length} possible genotypes</span>
              <span>·</span>
              <span>{viableCount} viable</span>
              {lethalCount > 0 && (
                <>
                  <span>·</span>
                  <span className="results-meta__lethal">{lethalCount} lethal</span>
                </>
              )}
              {calculatedAt && (
                <>
                  <span>·</span>
                  <span className="results-meta__time">
                    {new Date(calculatedAt).toLocaleTimeString()}
                  </span>
                </>
              )}
            </div>

            <div className="outcomes-grid">
              {outcomes.map((outcome, i) => (
                <OutcomeCard key={i} outcome={outcome} />
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
