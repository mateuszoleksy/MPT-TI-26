export type Unit = 'g' | 'dag' | 'kg' | 'ml' | 'l' | 'piece' | 'pieces' | 'pc' | 'pcs' | 'szt';

export type StandardUnit = 'kg' | 'l' | 'piece';

export interface UnitPrice {
  /** Price for exactly one standard unit. */
  price: number;
  unit: StandardUnit;
  category: 'mass' | 'volume' | 'count';
}

interface UnitDefinition {
  category: UnitPrice['category'];
  standardUnit: StandardUnit;
  unitsPerStandardUnit: number;
}

const UNIT_DEFINITIONS: Record<Unit, UnitDefinition> = {
  g: { category: 'mass', standardUnit: 'kg', unitsPerStandardUnit: 1000 },
  dag: { category: 'mass', standardUnit: 'kg', unitsPerStandardUnit: 100 },
  kg: { category: 'mass', standardUnit: 'kg', unitsPerStandardUnit: 1 },
  ml: { category: 'volume', standardUnit: 'l', unitsPerStandardUnit: 1000 },
  l: { category: 'volume', standardUnit: 'l', unitsPerStandardUnit: 1 },
  piece: { category: 'count', standardUnit: 'piece', unitsPerStandardUnit: 1 },
  pieces: { category: 'count', standardUnit: 'piece', unitsPerStandardUnit: 1 },
  pc: { category: 'count', standardUnit: 'piece', unitsPerStandardUnit: 1 },
  pcs: { category: 'count', standardUnit: 'piece', unitsPerStandardUnit: 1 },
  szt: { category: 'count', standardUnit: 'piece', unitsPerStandardUnit: 1 },
};

/** Calculates the price per kg, litre, or piece. */
export function calculateUnitPrice(price: number, quantity: number, unit: Unit): UnitPrice {
  if (!Number.isFinite(price) || price < 0) {
    throw new Error('Price must be a non-negative finite number.');
  }
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Quantity must be a positive finite number.');
  }

  const definition = UNIT_DEFINITIONS[unit];
  if (!definition) {
    throw new Error(`Unsupported unit: ${String(unit)}.`);
  }

  return {
    price: (price / quantity) * definition.unitsPerStandardUnit,
    unit: definition.standardUnit,
    category: definition.category,
  };
}

/** Compares two unit prices. Returns -1, 0, or 1. */
export function compareUnitPrices(left: UnitPrice, right: UnitPrice): -1 | 0 | 1 {
  if (left.category !== right.category || left.unit !== right.unit) {
    throw new Error('Unit prices must belong to the same category.');
  }
  if (!Number.isFinite(left.price) || !Number.isFinite(right.price)) {
    throw new Error('Unit prices must contain finite prices.');
  }

  return left.price < right.price ? -1 : left.price > right.price ? 1 : 0;
}
