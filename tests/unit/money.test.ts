import { describe, expect, it } from 'vitest';
import {
  add,
  cmp,
  dec,
  decimalPlaces,
  fmtMoney,
  isPositive,
  mul,
  roundCents,
} from '../../src/lib/money.js';

describe('money helpers', () => {
  it('multiplies 0.1 by 3 to exactly 0.3', () => {
    expect(mul('0.1', '3')).toBe('0.3');
  });

  it('adds 0.1 and 0.2 to exactly 0.3', () => {
    expect(add('0.1', '0.2')).toBe('0.3');
  });

  it('multiplies a quantity by a price without losing precision', () => {
    expect(mul('3.5', '187.33')).toBe('655.655');
  });

  it.each([
    ['1.005', '1.01'],
    ['1.004', '1.00'],
    ['2.675', '2.68'],
    ['-1.005', '-1.01'],
    ['7', '7.00'],
  ])('rounds %s half-up to %s', (value, expected) => {
    expect(roundCents(value)).toBe(expected);
  });

  it.each([
    ['10', 0],
    ['1.5', 1],
    ['1.50', 1],
    ['0.0001', 4],
    ['187.335', 3],
  ])('counts the decimal places of %s as %i', (value, expected) => {
    expect(decimalPlaces(value)).toBe(expected);
  });

  it.each([
    ['1', '2', -1],
    ['2.00', '2', 0],
    ['10', '9.99', 1],
  ])('compares %s with %s as %i', (a, b, expected) => {
    expect(cmp(a, b)).toBe(expected);
  });

  it.each([
    ['0.01', true],
    ['0', false],
    ['-5', false],
  ])('says whether %s is positive', (value, expected) => {
    expect(isPositive(value)).toBe(expected);
  });

  it.each(['1e3', ' 1', '+5', '1.', '.5', 'abc', ''])('refuses %j as a decimal string', (value) => {
    expect(() => dec(value)).toThrow('[Money] value is not a plain decimal string');
  });

  it('formats money for display with the currency code', () => {
    expect(fmtMoney('1234.5', 'USD')).toBe('$1,234.50 USD');
    expect(fmtMoney('99.999', 'CAD')).toBe('$100.00 CAD');
  });
});
