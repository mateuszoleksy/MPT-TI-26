import {
  formatPromotionDate,
  getPromotionLabel,
  getPromotionStatus,
  type PromotionPeriod,
} from '@promo/shared';

interface Props {
  period: PromotionPeriod;
  onDate: string;
}

const badge = {
  active: 'text-bg-success',
  upcoming: 'text-bg-primary',
  expired: 'text-bg-secondary',
} as const;

export function PromotionValidity({ period, onDate }: Props) {
  const status = getPromotionStatus(period, onDate);
  return (
    <div className="mt-3 small">
      <span className={`badge ${badge[status]}`}>{getPromotionLabel(period, onDate)}</span>
      <div className="mt-1 text-body-secondary">
        Ważne: {formatPromotionDate(period.validFrom)} – {formatPromotionDate(period.validTo)}
      </div>
    </div>
  );
}
