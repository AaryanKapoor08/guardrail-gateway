import Big from 'big.js';

// Money and quantities are decimal strings at the edges ("12.50") and Big numbers in between.
// JS numbers are never used for money: 0.1 + 0.2 !== 0.3 in floating point.

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;
const ROUND_HALF_UP = 1;

// True for plain decimal notation like "12", "0.5", "-3.25" (what `dec` accepts).
export function isDecimalString(value: string): boolean {
  return DECIMAL_STRING.test(value);
}

// Plain decimal notation only: no exponents ("1e3"), spaces, or signs like "+5".
export function dec(value: string): Big {
  if (!DECIMAL_STRING.test(value)) {
    throw new Error('[Money] value is not a plain decimal string');
  }
  return new Big(value);
}

export function mul(a: string, b: string): string {
  return dec(a).times(dec(b)).toFixed();
}

export function add(a: string, b: string): string {
  return dec(a).plus(dec(b)).toFixed();
}

// -1 if a < b, 0 if equal, 1 if a > b.
export function cmp(a: string, b: string): -1 | 0 | 1 {
  return dec(a).cmp(dec(b));
}

// Half-up to 2 decimal places, as people expect money to round: 1.005 -> 1.01.
export function roundCents(value: string): string {
  return dec(value).toFixed(2, ROUND_HALF_UP);
}

// Counts meaningful decimal places, ignoring trailing zeros: "1.50" -> 1, "0.0001" -> 4.
export function decimalPlaces(value: string): number {
  const normalized = dec(value).toFixed();
  const fractionPart = normalized.split('.')[1];
  return fractionPart === undefined ? 0 : fractionPart.length;
}

export function isPositive(value: string): boolean {
  return dec(value).gt(0);
}

// For display only: "$1,234.50 USD". The currency code is always shown because "$" alone
// can't tell US and Canadian dollars apart.
export function fmtMoney(value: string, currency: string): string {
  const rounded = roundCents(value) as Intl.StringNumericLiteral;
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
  });
  return `${formatter.format(rounded)} ${currency}`;
}

// SnapTrade sends some prices as JSON numbers. Big reads a number through its shortest decimal
// form (152.4 -> "152.4"), so this changes only the representation; no float maths happens.
export function decimalFromNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error('[Money] value is not a finite number');
  }
  return new Big(value).toFixed();
}
