import { describe, expect, it } from 'vitest';
import {
  daysBetween,
  formatPromotionDate,
  getPromotionDaysRemaining,
  getPromotionLabel,
  getPromotionStatus,
  isPromotionActiveOn,
  todayInWarsaw,
} from './promotionDates.js';

const period = { validFrom: '2026-11-05', validTo: '2026-11-11' };

describe('promotion dates', () => {
  it('includes the first and last day', () => {
    expect(getPromotionStatus(period, '2026-11-04')).toBe('upcoming');
    expect(getPromotionStatus(period, '2026-11-05')).toBe('active');
    expect(getPromotionStatus(period, '2026-11-11')).toBe('active');
    expect(getPromotionStatus(period, '2026-11-12')).toBe('expired');
    expect(isPromotionActiveOn(period, '2026-11-11')).toBe(true);
    expect(isPromotionActiveOn(period, '2026-11-12')).toBe(false);
  });

  it('returns meaningful remaining days and labels', () => {
    expect(getPromotionDaysRemaining(period, '2026-11-09')).toBe(2);
    expect(getPromotionLabel(period, '2026-11-09')).toBe('Pozostało 2 dni');
    expect(getPromotionLabel(period, '2026-11-10')).toBe('Koniec jutro');
    expect(getPromotionLabel(period, '2026-11-11')).toBe('Ostatni dzień promocji');
    expect(getPromotionLabel(period, '2026-11-12')).toBe('Promocja zakończona');
    expect(getPromotionLabel(period, '2026-11-04')).toBe('Start jutro');
    expect(getPromotionDaysRemaining(period, '2026-11-12')).toBe(0);
  });

  it('calculates across month and year boundaries', () => {
    expect(daysBetween('2026-12-31', '2027-01-02')).toBe(2);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
  });

  it('does not gain or lose a day at DST transition', () => {
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-10-24', '2026-10-26')).toBe(2);
  });

  it('uses Warsaw date rather than UTC date', () => {
    expect(todayInWarsaw(new Date('2026-11-09T23:30:00Z'))).toBe('2026-11-10');
    expect(todayInWarsaw(new Date('2026-06-01T22:30:00Z'))).toBe('2026-06-02');
  });

  it('rejects impossible and reversed dates', () => {
    expect(() => daysBetween('2026-02-30', '2026-03-01')).toThrow(RangeError);
    expect(() => daysBetween('2026-13-01', '2026-12-01')).toThrow(RangeError);
    expect(() => getPromotionStatus({ validFrom: '2026-11-12', validTo: '2026-11-11' })).toThrow(
      RangeError,
    );
  });

  it('supports one-day promotions', () => {
    const oneDay = { validFrom: '2026-11-09', validTo: '2026-11-09' };
    expect(getPromotionLabel(oneDay, '2026-11-09')).toBe('Ostatni dzień promocji');
    expect(formatPromotionDate('2026-11-09')).toBe('09.11.2026');
  });
});
