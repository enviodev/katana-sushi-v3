import { BigDecimal } from "envio";
import { MAX_BD, ZERO_BD, ZERO_BI } from "./constants.js";

// Sanitises a BigDecimal for safe Postgres `numeric` insertion. Two checks:
//
//   1. Magnitude — values past MAX_BD are zeroed. Catches the case where
//      pricing math on a misconfigured pool produces absurd derivedETH /
//      amountUSD values that would cascade through every downstream write.
//
//   2. Significant figures — values are rounded to BD_SIGNIFICANT_FIGURES sig
//      figs (NOT decimal places). bignumber.js multiplications compound
//      fractional digits, so a chain like `amount × derivedETH × ethPriceUSD
//      × …` can accumulate thousands of decimal places, breaching Postgres's
//      ~16,383-scale ceiling on `numeric` and triggering "value overflows
//      numeric format". Capping by significant figures keeps the magnitude-
//      relative precision intact (a price of 0.0004345 stays as 0.0004345
//      rather than being truncated to 0.0004 the way decimal-place rounding
//      would do — the latter caused an 8% bias on prices < 1).
const BD_SIGNIFICANT_FIGURES = 20;
export function clampBD(x: BigDecimal): BigDecimal {
  if (x.abs().gt(MAX_BD)) return ZERO_BD;
  return x.precision(BD_SIGNIFICANT_FIGURES);
}

export function isAddressInList(address: string, list: string[]): boolean {
  const a = address.toLowerCase();
  for (const item of list) {
    if (a === item.toLowerCase()) return true;
  }
  return false;
}

export function exponentToBigDecimal(decimals: bigint): BigDecimal {
  let s = "1";
  for (let i = 0n; i < decimals; i++) s += "0";
  return new BigDecimal(s);
}

export function safeDiv(num: BigDecimal, denom: BigDecimal): BigDecimal {
  return denom.eq(ZERO_BD) ? ZERO_BD : num.div(denom);
}

export function bigDecimalAbs(x: BigDecimal): BigDecimal {
  return x.lt(ZERO_BD) ? x.times(new BigDecimal("-1")) : x;
}

export function convertTokenToDecimal(
  tokenAmount: bigint,
  decimals: bigint,
): BigDecimal {
  const v = new BigDecimal(tokenAmount.toString());
  const result = decimals === ZERO_BI ? v : v.div(exponentToBigDecimal(decimals));
  return clampBD(result);
}

// Float-based fast power for non-integer bases. Mirrors the reference
// implementation; acceptable for derived prices that do not need exact
// big-decimal precision.
export function fastExponentiation(value: BigDecimal, power: bigint): BigDecimal {
  const v = parseFloat(value.toString());
  const p = parseInt(power.toString());
  const res = v ** p;
  if (!isFinite(res)) return ZERO_BD;
  return new BigDecimal(res.toString());
}

// Lowercase entity id helper. Forward-compat hook for multichain — currently
// just lowercases since Katana-only ids are plain addresses.
export function buildId(raw: string): string {
  return raw.toLowerCase();
}
