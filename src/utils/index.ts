import { BigDecimal } from "envio";
import { ZERO_BD, ZERO_BI } from "./constants.js";

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
  return decimals === ZERO_BI ? v : v.div(exponentToBigDecimal(decimals));
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
