// ============================================================
// src/utils/bigDecimal.ts
// Safe financial arithmetic using decimal.js
// NEVER use JS floats for money.
// ============================================================

import Decimal from 'decimal.js';

// Configure Decimal for financial precision
Decimal.set({
  precision: 38,
  rounding: Decimal.ROUND_DOWN, // conservative — never round up in user's favour
  toExpNeg: -28,
  toExpPos: 28,
});

/**
 * Add two amount strings safely.
 * @example add('0.1', '0.2') === '0.3'  (no float weirdness)
 */
export function add(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toFixed();
}

/**
 * Subtract b from a.
 */
export function subtract(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toFixed();
}

/**
 * Multiply two amounts.
 */
export function multiply(a: string, b: string): string {
  return new Decimal(a).times(new Decimal(b)).toFixed();
}

/**
 * Divide a by b. Throws if b is zero.
 */
export function divide(a: string, b: string): string {
  const divisor = new Decimal(b);
  if (divisor.isZero()) throw new Error('Division by zero');
  return new Decimal(a).div(divisor).toFixed();
}

export function isGreaterThan(a: string, b: string): boolean {
  return new Decimal(a).gt(new Decimal(b));
}

export function isGreaterThanOrEqual(a: string, b: string): boolean {
  return new Decimal(a).gte(new Decimal(b));
}

export function isLessThan(a: string, b: string): boolean {
  return new Decimal(a).lt(new Decimal(b));
}

export function isLessThanOrEqual(a: string, b: string): boolean {
  return new Decimal(a).lte(new Decimal(b));
}

export function isZero(a: string): boolean {
  return new Decimal(a).isZero();
}

export function isNegative(a: string): boolean {
  return new Decimal(a).isNegative();
}

export function isEqual(a: string, b: string): boolean {
  return new Decimal(a).eq(new Decimal(b));
}

/**
 * Convert a human-readable amount to the smallest unit (wei, satoshi, sun, etc.)
 * @param amount - e.g. '1.5' ETH
 * @param decimals - e.g. 18 for ETH
 * @returns bigint e.g. 1500000000000000000n
 */
export function toSmallestUnit(amount: string, decimals: number): bigint {
  const multiplier = new Decimal(10).pow(decimals);
  const result = new Decimal(amount).times(multiplier).toFixed(0);
  return BigInt(result);
}

/**
 * Convert smallest unit back to human-readable amount.
 * @param amount - smallest unit as bigint
 * @param decimals - e.g. 18 for ETH
 * @returns human-readable string e.g. '1.5'
 */
export function fromSmallestUnit(amount: bigint, decimals: number): string {
  const divisor = new Decimal(10).pow(decimals);
  return new Decimal(amount.toString()).div(divisor).toFixed();
}

/**
 * Format an amount to a fixed number of decimal places for display.
 */
export function formatAmount(amount: string, decimalPlaces = 8): string {
  return new Decimal(amount).toFixed(decimalPlaces);
}

/**
 * Validate that a string is a valid non-negative numeric amount.
 */
export function isValidPositiveAmount(amount: string): boolean {
  try {
    const d = new Decimal(amount);
    return d.isFinite() && !d.isNegative() && !d.isZero();
  } catch {
    return false;
  }
}

/**
 * Absolute value of an amount.
 */
export function abs(amount: string): string {
  return new Decimal(amount).abs().toFixed();
}

export { Decimal };
