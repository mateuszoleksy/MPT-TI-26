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

const colors = {
  active: { background: '#e7f6ec', foreground: '#176538' },
  upcoming: { background: '#e8f1ff', foreground: '#20589f' },
  expired: { background: '#f1f1f1', foreground: '#666' },
} as const;

export function PromotionValidity({ period, onDate }: Props) {
  const status = getPromotionStatus(period, onDate);
  const color = colors[status];
  return (
    <div style={{ marginTop: 10, fontSize: 12 }}>
      <span
        style={{
          background: color.background,
          color: color.foreground,
          display: 'inline-block',
          padding: '4px 7px',
          borderRadius: 6,
          fontWeight: 700,
        }}
      >
        {getPromotionLabel(period, onDate)}
      </span>
      <div style={{ marginTop: 6, color: '#555' }}>
        Ważne: {formatPromotionDate(period.validFrom)} – {formatPromotionDate(period.validTo)}
      </div>
    </div>
  );
}
