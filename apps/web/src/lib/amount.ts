import { MOCK_USDC_DECIMALS } from '@boundra/shared';
import { formatUnits, parseUnits } from 'viem';

const DECIMAL = new RegExp(`^(\\d{1,15})(?:\\.(\\d{1,${MOCK_USDC_DECIMALS}}))?$`);

export type ParsedAmount =
  { ok: true; baseUnits: string } | { ok: false; reason: 'EMPTY' | 'FORMAT' | 'ZERO' };

/**
 * Turns what the owner typed ("300", "12.5") into an exact base-unit string. Never goes through
 * a JavaScript number, so no amount is ever rounded.
 */
export function parseMockUsdc(input: string): ParsedAmount {
  const value = input.trim().replaceAll(',', '');
  if (!value) return { ok: false, reason: 'EMPTY' };
  if (!DECIMAL.test(value)) return { ok: false, reason: 'FORMAT' };
  const baseUnits = parseUnits(value, MOCK_USDC_DECIMALS);
  if (baseUnits === 0n) return { ok: false, reason: 'ZERO' };
  return { ok: true, baseUnits: baseUnits.toString() };
}

/** 1234.5 MockUSDC with digit grouping, exact to the token's 6 decimals. */
export function formatMockUsdc(baseUnits: bigint | string): string {
  const [whole, fraction] = formatUnits(BigInt(baseUnits), MOCK_USDC_DECIMALS).split('.');
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${grouped}${fraction ? `.${fraction}` : ''} MockUSDC`;
}
