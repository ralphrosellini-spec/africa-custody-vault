// ============================================================
// tests/unit/utils/bigDecimal.test.ts
// ============================================================

import {
  add,
  subtract,
  multiply,
  divide,
  isGreaterThan,
  isGreaterThanOrEqual,
  isLessThan,
  isNegative,
  isZero,
  toSmallestUnit,
  fromSmallestUnit,
  isValidPositiveAmount,
} from '../../../src/utils/bigDecimal';

describe('bigDecimal — safe financial arithmetic', () => {

  describe('add()', () => {
    it('should add two amounts correctly', () => {
      expect(add('100', '200')).toBe('300');
    });

    it('should NOT have 0.1 + 0.2 float weirdness', () => {
      const result = add('0.1', '0.2');
      expect(result).toBe('0.3');
      expect(result).not.toBe('0.30000000000000004'); // JS float bug
    });

    it('should handle large financial amounts', () => {
      expect(add('999999999.999999999', '0.000000001')).toBe('1000000000');
    });
  });

  describe('subtract()', () => {
    it('should subtract correctly', () => {
      expect(subtract('100', '30')).toBe('70');
    });

    it('should return negative for underflow', () => {
      const result = subtract('10', '20');
      expect(isNegative(result)).toBe(true);
    });
  });

  describe('multiply()', () => {
    it('should multiply fee percentage correctly', () => {
      expect(multiply('100', '0.02')).toBe('2');
    });

    it('should handle decimal precision', () => {
      expect(multiply('1.5', '2')).toBe('3');
    });
  });

  describe('divide()', () => {
    it('should divide correctly', () => {
      expect(divide('100', '4')).toBe('25');
    });

    it('should throw on division by zero', () => {
      expect(() => divide('100', '0')).toThrow('Division by zero');
    });
  });

  describe('comparison functions', () => {
    it('isGreaterThan: true when a > b', () => {
      expect(isGreaterThan('200', '100')).toBe(true);
    });

    it('isGreaterThan: false when a <= b', () => {
      expect(isGreaterThan('100', '100')).toBe(false);
      expect(isGreaterThan('50', '100')).toBe(false);
    });

    it('isGreaterThanOrEqual: true when equal', () => {
      expect(isGreaterThanOrEqual('100', '100')).toBe(true);
    });

    it('isLessThan: true when a < b', () => {
      expect(isLessThan('5', '10')).toBe(true);
    });

    it('isNegative: detects negative amounts', () => {
      expect(isNegative('-0.001')).toBe(true);
      expect(isNegative('0.001')).toBe(false);
    });

    it('isZero: detects zero amounts', () => {
      expect(isZero('0')).toBe(true);
      expect(isZero('0.0000')).toBe(true);
      expect(isZero('0.0001')).toBe(false);
    });
  });

  describe('toSmallestUnit()', () => {
    it('should convert 1 ETH to wei correctly', () => {
      expect(toSmallestUnit('1', 18)).toBe(1_000_000_000_000_000_000n);
    });

    it('should convert 1.5 ETH to wei', () => {
      expect(toSmallestUnit('1.5', 18)).toBe(1_500_000_000_000_000_000n);
    });

    it('should convert 1 BTC to satoshis', () => {
      expect(toSmallestUnit('1', 8)).toBe(100_000_000n);
    });

    it('should convert 0.001 BTC to satoshis', () => {
      expect(toSmallestUnit('0.001', 8)).toBe(100_000n);
    });

    it('should convert 1 USDT (6 decimals)', () => {
      expect(toSmallestUnit('1', 6)).toBe(1_000_000n);
    });
  });

  describe('fromSmallestUnit()', () => {
    it('should convert wei to ETH', () => {
      expect(fromSmallestUnit(1_000_000_000_000_000_000n, 18)).toBe('1');
    });

    it('should convert 1500000000000000000 wei to 1.5 ETH', () => {
      expect(fromSmallestUnit(1_500_000_000_000_000_000n, 18)).toBe('1.5');
    });

    it('should round-trip correctly', () => {
      const original = '0.123456789';
      const wei = toSmallestUnit(original, 9); // 9 decimals (SOL lamports)
      const back = fromSmallestUnit(wei, 9);
      expect(back).toBe(original);
    });
  });

  describe('isValidPositiveAmount()', () => {
    it('accepts valid positive amounts', () => {
      expect(isValidPositiveAmount('100')).toBe(true);
      expect(isValidPositiveAmount('0.001')).toBe(true);
    });

    it('rejects zero', () => {
      expect(isValidPositiveAmount('0')).toBe(false);
    });

    it('rejects negative amounts', () => {
      expect(isValidPositiveAmount('-1')).toBe(false);
    });

    it('rejects non-numeric strings', () => {
      expect(isValidPositiveAmount('abc')).toBe(false);
      expect(isValidPositiveAmount('')).toBe(false);
    });
  });
});
