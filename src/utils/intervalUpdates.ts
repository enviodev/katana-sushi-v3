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

export async function updateUniswapDayData(
  timestamp: number,
  factory: Factory,
  context: EvmOnEventContext,
): Promise<UniswapDayData> {
  const dayNum = Math.floor(timestamp / 86400);
  const dayStart = dayNum * 86400;
  const id = dayNum.toString();
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
  const dayID = Math.floor(timestamp / 86400);
  const dayStart = dayID * 86400;
  const id = `${pool.id}-${dayID}`;
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
  const hourIndex = Math.floor(timestamp / 3600);
  const hourStart = hourIndex * 3600;
  const id = `${pool.id}-${hourIndex}`;
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
  const dayID = Math.floor(timestamp / 86400);
  const dayStart = dayID * 86400;
  const id = `${token.id}-${dayID}`;
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
  const hourIndex = Math.floor(timestamp / 3600);
  const hourStart = hourIndex * 3600;
  const id = `${token.id}-${hourIndex}`;
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
