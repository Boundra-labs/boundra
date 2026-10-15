import { describe, expect, it } from 'vitest';
import { intentSchema, MAX_UINT256, tokenAmountSchema } from './index';

describe('authorization input boundaries', () => {
  it('preserves amounts above JavaScript safe integer exactly', () => {
    const value = '9007199254740993000000';
    expect(tokenAmountSchema.parse(value)).toBe(value);
    expect(tokenAmountSchema.parse(MAX_UINT256.toString())).toBe(MAX_UINT256.toString());
  });

  it.each(['-1', '1.5', '1e6', '01', '', (MAX_UINT256 + 1n).toString()])(
    'rejects invalid amount %s',
    (value) => {
      expect(tokenAmountSchema.safeParse(value).success).toBe(false);
    },
  );

  it('rejects wrong-chain, zero-amount and injected fields', () => {
    const valid = { objective: 'Manage safely', amount: '300000000', chainId: 84532 };
    expect(intentSchema.safeParse(valid).success).toBe(true);
    for (const invalid of [
      { ...valid, chainId: 1 },
      { ...valid, amount: '0' },
      { ...valid, target: 'arbitrary' },
    ]) {
      expect(intentSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
