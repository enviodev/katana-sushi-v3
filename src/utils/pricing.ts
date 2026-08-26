import { BigDecimal, type Bundle, type EvmOnEventContext, type Token } from "envio";
import { ONE_BD, Q192, ZERO_BD, ZERO_BI } from "./constants.js";
import { clampBD, exponentToBigDecimal, isAddressInList, safeDiv } from "./index.js";

// Q192 never changes, so stringifying it and reparsing a BigDecimal on every
// price conversion was pure waste — this runs once per Swap.
const Q192_BD = new BigDecimal(Q192.toString());

export function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: bigint,
  token0: Token,
  token1: Token,
): [BigDecimal, BigDecimal] {
  const num = new BigDecimal((sqrtPriceX96 * sqrtPriceX96).toString());
  const denom = Q192_BD;
  // No .dp(N) here: the reference Uniswap indexer applies .dp(4) at this
  // point but it catastrophically rounds prices < 1 (e.g. 0.000434 → 0.0004),
  // producing an 8% bias on every ETH/USD figure downstream. We instead rely
  // on clampBD's .precision(20) to cap growth at the entity-write boundary.
  const price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0.decimals))
    .div(exponentToBigDecimal(token1.decimals));
  const price0 = safeDiv(ONE_BD, price1);
  // Clamp magnitude + sig figs — a pool initialised with extreme sqrtPriceX96
  // can produce prices many orders past anything realistic, which then poisons
  // every downstream derivedETH and amountUSD.
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

  const poolIds = token.whitelistPools;
  if (poolIds.length === 0) return ZERO_BD;

  const pools = await Promise.all(poolIds.map((id) => context.Pool.get(id)));

  // Gather the counterpart side of every pool that can contribute, then load
  // those tokens in ONE batch. The previous shape awaited `Token.get` *inside*
  // the loop, so a token in N whitelist pools cost N sequential awaits — and
  // this runs twice per Swap, on the hottest path in the indexer. Same pools,
  // same order, same comparisons; only the loads are batched.
  const candidates: {
    ethLockedBase: BigDecimal;
    price: BigDecimal;
    counterpartId: string;
  }[] = [];

  for (const pool of pools) {
    if (!pool || pool.liquidity <= ZERO_BI) continue;

    if (pool.token0_id === token.id) {
      candidates.push({
        ethLockedBase: pool.totalValueLockedToken1,
        price: pool.token1Price,
        counterpartId: pool.token1_id,
      });
    }
    if (pool.token1_id === token.id) {
      candidates.push({
        ethLockedBase: pool.totalValueLockedToken0,
        price: pool.token0Price,
        counterpartId: pool.token0_id,
      });
    }
  }

  if (candidates.length === 0) return ZERO_BD;

  const counterparts = await Promise.all(
    candidates.map((c) => context.Token.get(c.counterpartId)),
  );

  let largestLiquidityETH = ZERO_BD;
  let priceSoFar = ZERO_BD;

  for (let i = 0; i < candidates.length; i++) {
    const counterpart = counterparts[i];
    if (!counterpart) continue;
    const c = candidates[i]!;
    const ethLocked = c.ethLockedBase.times(counterpart.derivedETH);
    if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumNativeLocked)) {
      largestLiquidityETH = ethLocked;
      priceSoFar = c.price.times(counterpart.derivedETH);
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
