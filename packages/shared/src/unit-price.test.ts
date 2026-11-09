import { describe, expect, it } from 'vitest';
import { calculateUnitPrice, compareUnitPrices } from './unit-price.js';

describe('calculateUnitPrice', () => {
	it('rejects a zero quantity', () => {
		expect(() => calculateUnitPrice(5, 0, 'kg')).toThrow(
			'Quantity must be a positive finite number.',
		);
	});

	it('rejects a missing unit', () => {
		expect(() => calculateUnitPrice(5, 1, undefined as never)).toThrow(
			'Unsupported unit: undefined.',
		);
	});

	it('converts grams to kilograms', () => {
		expect(calculateUnitPrice(2.5, 500, 'g')).toEqual({
			price: 5,
			unit: 'kg',
			category: 'mass',
		});
	});
});

describe('compareUnitPrices', () => {
	it('rejects comparisons between incompatible units', () => {
		const pricePerKilogram = calculateUnitPrice(5, 1, 'kg');
		const pricePerLitre = calculateUnitPrice(5, 1, 'l');

		expect(() => compareUnitPrices(pricePerKilogram, pricePerLitre)).toThrow(
			'Unit prices must belong to the same category.',
		);
	});
});
