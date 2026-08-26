import {
  type Bundle,
  type EvmOnEventContext,
  type Factory,
  type Pool,
  type PoolDayData,
  type PoolHourData,
  type Tick,
  type TickDayData,
  type TickHourData,
  type Token,
  type TokenDayData,
  type TokenHourData,
  type UniswapDayData,
} from "envio";
import { ONE_BI, ZERO_BD, ZERO_BI } from "./constants.js";

// Single source of truth for interval-data ids. The update functions below and
// `preloadIntervalData` both build ids from these, so the warm path cannot
// drift from the read path — if it did, the preload would silently miss rows
// and the processing pass would load them one at a time.
export const dayIndexOf = (timestamp: number): number => Math.floor(timestamp / 86400);
export const hourIndexOf = (timestamp: number): number => Math.floor(timestamp / 3600);

export const uniswapDayDataId = (timestamp: number): string => dayIndexOf(timestamp).toString();
export const poolDayDataId = (poolId: string, timestamp: number): string =>
  `${poolId}-${dayIndexOf(timestamp)}`;
export const poolHourDataId = (poolId: string, timestamp: number): string =>
  `${poolId}-${hourIndexOf(timestamp)}`;
export const tokenDayDataId = (tokenId: string, timestamp: number): string =>
  `${tokenId}-${dayIndexOf(timestamp)}`;
export const tokenHourDataId = (tokenId: string, timestamp: number): string =>
  `${tokenId}-${hourIndexOf(timestamp)}`;

// Warm every interval row a pool-level handler will read, as one batch.
//
// Used from the preload phase, where storage writes are ignored: issuing the
// reads is the entire point of that pass, and the arithmetic that normally
// follows them would be thrown away.
export async function preloadIntervalData(
  timestamp: number,
  poolId: string,
  token0Id: string,
  token1Id: string,
  context: EvmOnEventContext,
): Promise<void> {
  await Promise.all([
    context.UniswapDayData.get(uniswapDayDataId(timestamp)),
    context.PoolDayData.get(poolDayDataId(poolId, timestamp)),
    context.PoolHourData.get(poolHourDataId(poolId, timestamp)),
    context.TokenDayData.get(tokenDayDataId(token0Id, timestamp)),
    context.TokenDayData.get(tokenDayDataId(token1Id, timestamp)),
    context.TokenHourData.get(tokenHourDataId(token0Id, timestamp)),
    context.TokenHourData.get(tokenHourDataId(token1Id, timestamp)),
  ]);
}

export async function updateUniswapDayData(
  timestamp: number,
  factory: Factory,
  context: EvmOnEventContext,
): Promise<UniswapDayData> {
  const dayNum = dayIndexOf(timestamp);
  const dayStart = dayNum * 86400;
  const id = uniswapDayDataId(timestamp);
  const existing = await context.UniswapDayData.get(id);
  const updated: UniswapDayData = {
    id,
    date: dayStart,
    volumeETH: existing?.volumeETH ?? ZERO_BD,
    volumeUSD: existing?.volumeUSD ?? ZERO_BD,
    volumeUSDUntracked: existing?.volumeUSDUntracked ?? ZERO_BD,
    feesUSD: existing?.feesUSD ?? ZERO_BD,
    txCount: factory.txCount,
    tvlUSD: factory.totalValueLockedUSD,
  };
  context.UniswapDayData.set(updated);
  return updated;
}

export async function updatePoolDayData(
  timestamp: number,
  pool: Pool,
  context: EvmOnEventContext,
): Promise<PoolDayData> {
  const dayID = dayIndexOf(timestamp);
  const dayStart = dayID * 86400;
  const id = poolDayDataId(pool.id, timestamp);
  const existing = await context.PoolDayData.get(id);

  const open = existing?.open ?? pool.token0Price;
  let high = existing?.high ?? pool.token0Price;
  let low = existing?.low ?? pool.token0Price;
  if (pool.token0Price.gt(high)) high = pool.token0Price;
  if (pool.token0Price.lt(low)) low = pool.token0Price;

  const updated: PoolDayData = {
    id,
    date: dayStart,
    pool_id: pool.id,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    tick: pool.tick,
    feeGrowthGlobal0X128: pool.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: pool.feeGrowthGlobal1X128,
    tvlUSD: pool.totalValueLockedUSD,
    volumeToken0: existing?.volumeToken0 ?? ZERO_BD,
    volumeToken1: existing?.volumeToken1 ?? ZERO_BD,
    volumeUSD: existing?.volumeUSD ?? ZERO_BD,
    feesUSD: existing?.feesUSD ?? ZERO_BD,
    txCount: (existing?.txCount ?? ZERO_BI) + ONE_BI,
    open,
    high,
    low,
    close: pool.token0Price,
  };
  context.PoolDayData.set(updated);
  return updated;
}

export async function updatePoolHourData(
  timestamp: number,
  pool: Pool,
  context: EvmOnEventContext,
): Promise<PoolHourData> {
  const hourIndex = hourIndexOf(timestamp);
  const hourStart = hourIndex * 3600;
  const id = poolHourDataId(pool.id, timestamp);
  const existing = await context.PoolHourData.get(id);

  const open = existing?.open ?? pool.token0Price;
  let high = existing?.high ?? pool.token0Price;
  let low = existing?.low ?? pool.token0Price;
  if (pool.token0Price.gt(high)) high = pool.token0Price;
  if (pool.token0Price.lt(low)) low = pool.token0Price;

  const updated: PoolHourData = {
    id,
    periodStartUnix: hourStart,
    pool_id: pool.id,
    liquidity: pool.liquidity,
    sqrtPrice: pool.sqrtPrice,
    token0Price: pool.token0Price,
    token1Price: pool.token1Price,
    tick: pool.tick,
    feeGrowthGlobal0X128: pool.feeGrowthGlobal0X128,
    feeGrowthGlobal1X128: pool.feeGrowthGlobal1X128,
    tvlUSD: pool.totalValueLockedUSD,
    volumeToken0: existing?.volumeToken0 ?? ZERO_BD,
    volumeToken1: existing?.volumeToken1 ?? ZERO_BD,
    volumeUSD: existing?.volumeUSD ?? ZERO_BD,
    feesUSD: existing?.feesUSD ?? ZERO_BD,
    txCount: (existing?.txCount ?? ZERO_BI) + ONE_BI,
    open,
    high,
    low,
    close: pool.token0Price,
  };
  context.PoolHourData.set(updated);
  return updated;
}

export async function updateTokenDayData(
  timestamp: number,
  token: Token,
  bundle: Bundle,
  context: EvmOnEventContext,
): Promise<TokenDayData> {
  const dayID = dayIndexOf(timestamp);
  const dayStart = dayID * 86400;
  const id = tokenDayDataId(token.id, timestamp);
  const tokenPrice = token.derivedETH.times(bundle.ethPriceUSD);
  const existing = await context.TokenDayData.get(id);

  const open = existing?.open ?? tokenPrice;
  let high = existing?.high ?? tokenPrice;
  let low = existing?.low ?? tokenPrice;
  if (tokenPrice.gt(high)) high = tokenPrice;
  if (tokenPrice.lt(low)) low = tokenPrice;

  const updated: TokenDayData = {
    id,
    date: dayStart,
    token_id: token.id,
    volume: existing?.volume ?? ZERO_BD,
    volumeUSD: existing?.volumeUSD ?? ZERO_BD,
    untrackedVolumeUSD: existing?.untrackedVolumeUSD ?? ZERO_BD,
    feesUSD: existing?.feesUSD ?? ZERO_BD,
    open,
    high,
    low,
    close: tokenPrice,
    priceUSD: tokenPrice,
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
  };
  context.TokenDayData.set(updated);
  return updated;
}

export async function updateTokenHourData(
  timestamp: number,
  token: Token,
  bundle: Bundle,
  context: EvmOnEventContext,
): Promise<TokenHourData> {
  const hourIndex = hourIndexOf(timestamp);
  const hourStart = hourIndex * 3600;
  const id = tokenHourDataId(token.id, timestamp);
  const tokenPrice = token.derivedETH.times(bundle.ethPriceUSD);
  const existing = await context.TokenHourData.get(id);

  const open = existing?.open ?? tokenPrice;
  let high = existing?.high ?? tokenPrice;
  let low = existing?.low ?? tokenPrice;
  if (tokenPrice.gt(high)) high = tokenPrice;
  if (tokenPrice.lt(low)) low = tokenPrice;

  const updated: TokenHourData = {
    id,
    periodStartUnix: hourStart,
    token_id: token.id,
    volume: existing?.volume ?? ZERO_BD,
    volumeUSD: existing?.volumeUSD ?? ZERO_BD,
    untrackedVolumeUSD: existing?.untrackedVolumeUSD ?? ZERO_BD,
    feesUSD: existing?.feesUSD ?? ZERO_BD,
    open,
    high,
    low,
    close: tokenPrice,
    priceUSD: tokenPrice,
    totalValueLocked: token.totalValueLocked,
    totalValueLockedUSD: token.totalValueLockedUSD,
  };
  context.TokenHourData.set(updated);
  return updated;
}

export async function updateTickDayData(
  timestamp: number,
  tick: Tick,
  context: EvmOnEventContext,
): Promise<TickDayData> {
  const dayID = Math.floor(timestamp / 86400);
  const dayStart = dayID * 86400;
  const id = `${tick.id}-${dayID}`;
  const updated: TickDayData = {
    id,
    date: dayStart,
    pool_id: tick.pool_id,
    tick_id: tick.id,
    liquidityGross: tick.liquidityGross,
    liquidityNet: tick.liquidityNet,
    volumeToken0: tick.volumeToken0,
    volumeToken1: tick.volumeToken1,
    volumeUSD: tick.volumeUSD,
    feesUSD: tick.feesUSD,
    feeGrowthOutside0X128: tick.feeGrowthOutside0X128,
    feeGrowthOutside1X128: tick.feeGrowthOutside1X128,
  };
  context.TickDayData.set(updated);
  return updated;
}

// TickHourData is declared in the schema but not populated by the subgraph
// mappings; we write minimal liquidity state on Mint/Burn so the entity at
// least exists for queries. Volume fields remain zero.
export async function updateTickHourData(
  timestamp: number,
  tick: Tick,
  context: EvmOnEventContext,
): Promise<TickHourData> {
  const hourIndex = Math.floor(timestamp / 3600);
  const hourStart = hourIndex * 3600;
  const id = `${tick.id}-${hourIndex}`;
  const updated: TickHourData = {
    id,
    periodStartUnix: hourStart,
    pool_id: tick.pool_id,
    tick_id: tick.id,
    liquidityGross: tick.liquidityGross,
    liquidityNet: tick.liquidityNet,
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
  };
  context.TickHourData.set(updated);
  return updated;
}
