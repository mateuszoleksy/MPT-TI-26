/**
 * Promotion date rules are based on calendar days in Europe/Warsaw.
 * Dates are YYYY-MM-DD strings, not timestamps. Both boundaries are inclusive.
 */
export type PromotionStatus = 'upcoming' | 'active' | 'expired';
export interface PromotionPeriod {
  validFrom: string;
  validTo: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;

function dayNumber(value: string): number {
  if (!ISO_DAY.test(value)) throw new RangeError(`Invalid date: ${value}`);
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const check = new Date(timestamp);
  // Date.UTC treats years 0–99 specially; reject rather than silently shift.
  if (
    year < 100 ||
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    throw new RangeError(`Invalid date: ${value}`);
  }
  return timestamp / MS_PER_DAY;
}

export function todayInWarsaw(now = new Date()): string {
  // formatToParts avoids relying on locale-specific ordering of formatted dates.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function getPromotionStatus(
  period: PromotionPeriod,
  onDate = todayInWarsaw(),
): PromotionStatus {
  const start = dayNumber(period.validFrom);
  const end = dayNumber(period.validTo);
  const day = dayNumber(onDate);
  if (end < start) throw new RangeError('Promotion end date is before its start date');
  if (day < start) return 'upcoming';
  if (day > end) return 'expired';
  return 'active';
}

export function isPromotionActiveOn(period: PromotionPeriod, onDate: string): boolean {
  return getPromotionStatus(period, onDate) === 'active';
}

/** Non-negative days left until the start/end. Returns 0 on the boundary itself. */
export function getPromotionDaysRemaining(
  period: PromotionPeriod,
  onDate = todayInWarsaw(),
): number {
  const status = getPromotionStatus(period, onDate);
  if (status === 'expired') return 0;
  return daysBetween(onDate, status === 'upcoming' ? period.validFrom : period.validTo);
}

export function getPromotionLabel(period: PromotionPeriod, onDate = todayInWarsaw()): string {
  const status = getPromotionStatus(period, onDate);
  const days = getPromotionDaysRemaining(period, onDate);
  if (status === 'expired') return 'Promocja zakończona';
  if (status === 'upcoming') {
    if (days === 1) return 'Start jutro';
    return `Start za ${days} dni`;
  }
  if (days === 0) return 'Ostatni dzień promocji';
  if (days === 1) return 'Koniec jutro';
  return `Pozostało ${days} dni`;
}

export function formatPromotionDate(value: string): string {
  dayNumber(value);
  const [year, month, day] = value.split('-');
  return `${day}.${month}.${year}`;
}
