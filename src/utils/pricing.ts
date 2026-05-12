import { BigDecimal, type Bundle, type EvmOnEventContext, type Token } from "envio";
import { ONE_BD, Q192, ZERO_BD, ZERO_BI } from "./constants.js";
import { clampBD, exponentToBigDecimal, isAddressInList, safeDiv } from "./index.js";

export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: bigint,
  token0: Token,
  token1: Token,
): [BigDecimal, BigDecimal] {
  const num = new BigDecimal((sqrtPriceX96 * sqrtPriceX96).toString());
  const denom = new BigDecimal(Q192.toString());
  // .dp(4) caps fractional-digit growth so chained multiplications downstream
  // don't blow up arbitrary-precision BigDecimal internals — matches the
  // reference Uniswap V3 indexer's behaviour.
  const price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0.decimals))
    .div(exponentToBigDecimal(token1.decimals))
    .dp(4);
  const price0 = safeDiv(ONE_BD, price1);
  // Clamp magnitude — a pool initialised with extreme sqrtPriceX96 can produce
  // prices many orders past anything realistic, which then poisons every
  // downstream derivedETH and amountUSD.
  return [clampBD(price0), clampBD(price1)];
}

export async function getNativePriceInUSD(
  context: EvmOnEventContext,
  stablecoinWrappedNativePoolId: string,
  stablecoinIsToken0: boolean,
): Promise<BigDecimal> {
  const pool = await context.Pool.get(stablecoinWrappedNativePoolId.toLowerCase());
  if (!pool) return ZERO_BD;
  return clampBD(stablecoinIsToken0 ? pool.token0Price : pool.token1Price);
}

export async function findNativePerToken(
  context: EvmOnEventContext,
  token: Token,
  bundle: Bundle,
  wrappedNativeAddress: string,
  stablecoinAddresses: string[],
  minimumNativeLocked: BigDecimal,
): Promise<BigDecimal> {
  const tokenAddress = token.id;
  if (tokenAddress === wrappedNativeAddress.toLowerCase()) return ONE_BD;
  if (isAddressInList(tokenAddress, stablecoinAddresses)) {
    return safeDiv(ONE_BD, bundle.ethPriceUSD);
  }

  const pools = await Promise.all(
    token.whitelistPools.map((id) => context.Pool.get(id)),
  );

  let largestLiquidityETH = ZERO_BD;
  let priceSoFar = ZERO_BD;

  for (const pool of pools) {
    if (!pool || pool.liquidity <= ZERO_BI) continue;

    if (pool.token0_id === token.id) {
      const t1 = await context.Token.get(pool.token1_id);
      if (t1) {
        const ethLocked = pool.totalValueLockedToken1.times(t1.derivedETH);
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumNativeLocked)) {
          largestLiquidityETH = ethLocked;
          priceSoFar = pool.token1Price.times(t1.derivedETH);
        }
      }
    }
    if (pool.token1_id === token.id) {
      const t0 = await context.Token.get(pool.token0_id);
      if (t0) {
        const ethLocked = pool.totalValueLockedToken0.times(t0.derivedETH);
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumNativeLocked)) {
          largestLiquidityETH = ethLocked;
          priceSoFar = pool.token0Price.times(t0.derivedETH);
        }
      }
    }
  }
  return clampBD(priceSoFar);
}

export function getTrackedAmountUSD(
  bundle: Bundle,
  amount0: BigDecimal,
  token0: Token,
  amount1: BigDecimal,
  token1: Token,
  whitelistTokens: string[],
): BigDecimal {
  const price0USD = token0.derivedETH.times(bundle.ethPriceUSD);
  const price1USD = token1.derivedETH.times(bundle.ethPriceUSD);

  const t0White = isAddressInList(token0.id, whitelistTokens);
  const t1White = isAddressInList(token1.id, whitelistTokens);

  if (t0White && t1White) {
    return clampBD(amount0.times(price0USD).plus(amount1.times(price1USD)));
  }
  if (t0White && !t1White) {
    return clampBD(amount0.times(price0USD).times(new BigDecimal("2")));
  }
  if (!t0White && t1White) {
    return clampBD(amount1.times(price1USD).times(new BigDecimal("2")));
  }
  return ZERO_BD;
}

export function calculateAmountUSD(
  amount0: BigDecimal,
  amount1: BigDecimal,
  t0DerivedETH: BigDecimal,
  t1DerivedETH: BigDecimal,
  ethPriceUSD: BigDecimal,
): BigDecimal {
  return clampBD(
    amount0
      .times(t0DerivedETH.times(ethPriceUSD))
      .plus(amount1.times(t1DerivedETH.times(ethPriceUSD))),
  );
}
