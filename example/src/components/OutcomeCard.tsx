import type { AggregatedOutcome, PossibleHet } from '../../../src/types';
import './OutcomeCard.css';

function formatLocusName(locusId: string): string {
  return locusId
    .replace(/_locus$/, '')
    .replace(/_complex$/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatHet(het: PossibleHet): string {
  const name = formatLocusName(het.locusId);
  const pct = Math.round(het.probability * 100);
  return het.isGuaranteed ? `100% Het ${name}` : `${pct}% Poss-Het ${name}`;
}

interface OutcomeCardProps {
  outcome: AggregatedOutcome;
}

export function OutcomeCard({ outcome }: OutcomeCardProps): JSX.Element {
  const displayName =
    outcome.comboName ??
    (outcome.phenotypeNames.length > 0 ? outcome.phenotypeNames.join(' ') : 'Normal');

  const cardClass = [
    'outcome-card',
    outcome.isLethal ? 'outcome-card--lethal' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={cardClass}>
      <div className="outcome-card__header">
        <span className="outcome-card__name">{displayName}</span>
        <span className="outcome-card__probability">{outcome.percentageProbability}</span>
      </div>

      {outcome.possibleHets.length > 0 && (
        <ul className="outcome-card__hets">
          {outcome.possibleHets.map((het) => (
            <li key={het.locusId}>{formatHet(het)}</li>
          ))}
        </ul>
      )}

      {outcome.isLethal && (
        <div className="outcome-card__lethal-banner">⚠ LETHAL COMBINATION</div>
      )}

      {outcome.congenitalWarnings.length > 0 && (
        <div className="outcome-card__warnings">
          <strong>Congenital warnings:</strong>
          <ul>
            {outcome.congenitalWarnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
