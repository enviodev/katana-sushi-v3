// Pool Swap: largest handler. Updates pool/factory/token aggregates, recomputes
// prices and derivedETH, creates a Swap entity, refreshes feeGrowthGlobal via
// RPC, and walks any tick-crossings to refresh fee-growth-outside on each.
import { BigDecimal, indexer, type EvmOnEventContext, type Swap } from "envio";
import { getChainConfig } from "../utils/chains.js";
import { FACTORY_ADDRESS, ONE_BI, ZERO_BD, ZERO_BI } from "../utils/constants.js";
import { bigDecimalAbs, convertTokenToDecimal, safeDiv } from "../utils/index.js";
import {
  findNativePerToken,
  getNativePriceInUSD,
  getTrackedAmountUSD,
  sqrtPriceX96ToTokenPrices,
} from "../utils/pricing.js";
import {
  updatePoolDayData,
  updatePoolHourData,
  updateTickDayData,
  updateTokenDayData,
  updateTokenHourData,
  updateUniswapDayData,
} from "../utils/intervalUpdates.js";
import { feeTierToTickSpacing } from "../utils/tick.js";
import { loadOrCreateTransaction } from "../utils/transaction.js";
import { FETCH_FEE_GROWTH } from "../utils/flags.js";
import { getPoolFeeGrowth } from "../effects/poolFeeGrowth.js";
import { getPoolTickInfo } from "../effects/poolTickInfo.js";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "Swap" },
  async ({ event, context }) => {
    const chainId = context.chain.id;
    const cfg = getChainConfig(chainId);
    const poolId = event.srcAddress.toLowerCase();

    const [poolRO, bundleRO, factoryRO] = await Promise.all([
      context.Pool.get(poolId),
      context.Bundle.get("1"),
      context.Factory.get(FACTORY_ADDRESS),
    ]);
    if (!poolRO || !bundleRO || !factoryRO) return;

    const [token0RO, token1RO] = await Promise.all([
      context.Token.get(poolRO.token0_id),
      context.Token.get(poolRO.token1_id),
    ]);
    if (!token0RO || !token1RO) return;

    const oldTick = poolRO.tick;

    const amount0 = convertTokenToDecimal(event.params.amount0, token0RO.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1RO.decimals);
    const amount0Abs = bigDecimalAbs(amount0);
    const amount1Abs = bigDecimalAbs(amount1);

    const amount0ETH = amount0Abs.times(token0RO.derivedETH);
    const amount1ETH = amount1Abs.times(token1RO.derivedETH);
    const amount0USD = amount0ETH.times(bundleRO.ethPriceUSD);
    const amount1USD = amount1ETH.times(bundleRO.ethPriceUSD);

    const amountTotalUSDTracked = safeDiv(
      getTrackedAmountUSD(bundleRO, amount0Abs, token0RO, amount1Abs, token1RO, cfg.whitelistTokens),
      new BigDecimal("2"),
    );
    const amountTotalETHTracked = safeDiv(amountTotalUSDTracked, bundleRO.ethPriceUSD);
    const amountTotalUSDUntracked = safeDiv(amount0USD.plus(amount1USD), new BigDecimal("2"));

    const feeScaler = new BigDecimal(poolRO.feeTier.toString()).div(new BigDecimal("1000000"));
    const feesETH = amountTotalETHTracked.times(feeScaler);
    const feesUSD = amountTotalUSDTracked.times(feeScaler);

    // Fetch new feeGrowthGlobal for this pool at the current block.
    // Gated behind ENVIO_FETCH_FEE_GROWTH — when disabled the field stays
    // at its previous value (initially zero).
    const fg = FETCH_FEE_GROWTH
      ? await context.effect(getPoolFeeGrowth, {
          address: event.srcAddress,
          blockNumber: event.block.number,
        })
      : null;

    // Build the new pool state in stages, then write once at the end.
    const newSqrtPrice = event.params.sqrtPriceX96;
    const newTick = event.params.tick;

    // Compute prices from the new sqrtPrice with the token decimals.
    const [token0Price, token1Price] = sqrtPriceX96ToTokenPrices(newSqrtPrice, token0RO, token1RO);

    // Refresh derived ETH after writing the pool (other tokens' pricing reads
    // pool state, so write pool first then update tokens).
    let pool = {
      ...poolRO,
      volumeToken0: poolRO.volumeToken0.plus(amount0Abs),
      volumeToken1: poolRO.volumeToken1.plus(amount1Abs),
      volumeUSD: poolRO.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: poolRO.untrackedVolumeUSD.plus(amountTotalUSDUntracked),
      feesUSD: poolRO.feesUSD.plus(feesUSD),
      txCount: poolRO.txCount + ONE_BI,
      liquidity: event.params.liquidity,
      tick: newTick,
      sqrtPrice: newSqrtPrice,
      totalValueLockedToken0: poolRO.totalValueLockedToken0.plus(amount0),
      totalValueLockedToken1: poolRO.totalValueLockedToken1.plus(amount1),
      token0Price,
      token1Price,
      feeGrowthGlobal0X128: fg ? BigInt(fg.feeGrowthGlobal0X128) : poolRO.feeGrowthGlobal0X128,
      feeGrowthGlobal1X128: fg ? BigInt(fg.feeGrowthGlobal1X128) : poolRO.feeGrowthGlobal1X128,
    };
    context.Pool.set(pool);

    // Update bundle ETH price (other pool may have just become initialised).
    const newEthPriceUSD = await getNativePriceInUSD(
      context,
      cfg.stablecoinWrappedNativePoolId,
      cfg.stablecoinIsToken0,
    );
    const bundle = { ...bundleRO, ethPriceUSD: newEthPriceUSD };
    context.Bundle.set(bundle);

    // Update token aggregates (volume / TVL token amounts only — derivedETH
    // and TVL USD are recomputed below once we have the fresh price).
    let token0 = {
      ...token0RO,
      volume: token0RO.volume.plus(amount0Abs),
      totalValueLocked: token0RO.totalValueLocked.plus(amount0),
      volumeUSD: token0RO.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: token0RO.untrackedVolumeUSD.plus(amountTotalUSDUntracked),
      feesUSD: token0RO.feesUSD.plus(feesUSD),
      txCount: token0RO.txCount + ONE_BI,
    };
    let token1 = {
      ...token1RO,
      volume: token1RO.volume.plus(amount1Abs),
      totalValueLocked: token1RO.totalValueLocked.plus(amount1),
      volumeUSD: token1RO.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: token1RO.untrackedVolumeUSD.plus(amountTotalUSDUntracked),
      feesUSD: token1RO.feesUSD.plus(feesUSD),
      txCount: token1RO.txCount + ONE_BI,
    };

    const [derived0, derived1] = await Promise.all([
      findNativePerToken(context, token0, bundle, cfg.wrappedNativeAddress, cfg.stablecoinAddresses, cfg.minimumNativeLocked),
      findNativePerToken(context, token1, bundle, cfg.wrappedNativeAddress, cfg.stablecoinAddresses, cfg.minimumNativeLocked),
    ]);
    token0 = { ...token0, derivedETH: derived0 };
    token1 = { ...token1, derivedETH: derived1 };

    // Pool TVL in ETH/USD using new derived prices.
    const newPoolTvlETH = pool.totalValueLockedToken0
      .times(token0.derivedETH)
      .plus(pool.totalValueLockedToken1.times(token1.derivedETH));
    pool = {
      ...pool,
      totalValueLockedETH: newPoolTvlETH,
      totalValueLockedUSD: newPoolTvlETH.times(bundle.ethPriceUSD),
    };
    context.Pool.set(pool);

    token0 = {
      ...token0,
      totalValueLockedUSD: token0.totalValueLocked.times(token0.derivedETH).times(bundle.ethPriceUSD),
    };
    token1 = {
      ...token1,
      totalValueLockedUSD: token1.totalValueLocked.times(token1.derivedETH).times(bundle.ethPriceUSD),
    };
    context.Token.set(token0);
    context.Token.set(token1);

    // Factory aggregates. Reset prev pool TVL then add new pool TVL.
    const newFactoryTvlETH = factoryRO.totalValueLockedETH
      .minus(poolRO.totalValueLockedETH)
      .plus(pool.totalValueLockedETH);
    const factory = {
      ...factoryRO,
      txCount: factoryRO.txCount + ONE_BI,
      totalVolumeETH: factoryRO.totalVolumeETH.plus(amountTotalETHTracked),
      totalVolumeUSD: factoryRO.totalVolumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: factoryRO.untrackedVolumeUSD.plus(amountTotalUSDUntracked),
      totalFeesETH: factoryRO.totalFeesETH.plus(feesETH),
      totalFeesUSD: factoryRO.totalFeesUSD.plus(feesUSD),
      totalValueLockedETH: newFactoryTvlETH,
      totalValueLockedUSD: newFactoryTvlETH.times(bundle.ethPriceUSD),
    };
    context.Factory.set(factory);

    // Swap entity.
    const transaction = await loadOrCreateTransaction(event, context);
    const swap: Swap = {
      id: `${transaction.id}#${pool.txCount.toString()}`,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      sender: event.params.sender.toLowerCase(),
      recipient: event.params.recipient.toLowerCase(),
      origin: (event.transaction.from ?? "").toLowerCase(),
      amount0,
      amount1,
      amountUSD: amountTotalUSDTracked,
      sqrtPriceX96: newSqrtPrice,
      tick: newTick,
      logIndex: BigInt(event.logIndex),
    };
    context.Swap.set(swap);

    // Interval data with volume increments.
    const ts = event.block.timestamp;
    await updateUniswapDayData(ts, factory, context);
    // updateUniswapDayData wrote tvl/txCount; add volume/fee here.
    {
      const dayNum = Math.floor(ts / 86400);
      const dayId = dayNum.toString();
      const day = await context.UniswapDayData.get(dayId);
      if (day) {
        context.UniswapDayData.set({
          ...day,
          volumeETH: day.volumeETH.plus(amountTotalETHTracked),
          volumeUSD: day.volumeUSD.plus(amountTotalUSDTracked),
          feesUSD: day.feesUSD.plus(feesUSD),
        });
      }
    }

    const pdd = await updatePoolDayData(ts, pool, context);
    context.PoolDayData.set({
      ...pdd,
      volumeToken0: pdd.volumeToken0.plus(amount0Abs),
      volumeToken1: pdd.volumeToken1.plus(amount1Abs),
      volumeUSD: pdd.volumeUSD.plus(amountTotalUSDTracked),
      feesUSD: pdd.feesUSD.plus(feesUSD),
    });

    const phd = await updatePoolHourData(ts, pool, context);
    context.PoolHourData.set({
      ...phd,
      volumeToken0: phd.volumeToken0.plus(amount0Abs),
      volumeToken1: phd.volumeToken1.plus(amount1Abs),
      volumeUSD: phd.volumeUSD.plus(amountTotalUSDTracked),
      feesUSD: phd.feesUSD.plus(feesUSD),
    });

    const t0dd = await updateTokenDayData(ts, token0, bundle, context);
    context.TokenDayData.set({
      ...t0dd,
      volume: t0dd.volume.plus(amount0Abs),
      volumeUSD: t0dd.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: t0dd.untrackedVolumeUSD.plus(amountTotalUSDTracked),
      feesUSD: t0dd.feesUSD.plus(feesUSD),
    });
    const t1dd = await updateTokenDayData(ts, token1, bundle, context);
    context.TokenDayData.set({
      ...t1dd,
      volume: t1dd.volume.plus(amount1Abs),
      volumeUSD: t1dd.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: t1dd.untrackedVolumeUSD.plus(amountTotalUSDTracked),
      feesUSD: t1dd.feesUSD.plus(feesUSD),
    });

    const t0hd = await updateTokenHourData(ts, token0, bundle, context);
    context.TokenHourData.set({
      ...t0hd,
      volume: t0hd.volume.plus(amount0Abs),
      volumeUSD: t0hd.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: t0hd.untrackedVolumeUSD.plus(amountTotalUSDTracked),
      feesUSD: t0hd.feesUSD.plus(feesUSD),
    });
    const t1hd = await updateTokenHourData(ts, token1, bundle, context);
    context.TokenHourData.set({
      ...t1hd,
      volume: t1hd.volume.plus(amount1Abs),
      volumeUSD: t1hd.volumeUSD.plus(amountTotalUSDTracked),
      untrackedVolumeUSD: t1hd.untrackedVolumeUSD.plus(amountTotalUSDTracked),
      feesUSD: t1hd.feesUSD.plus(feesUSD),
    });

    // Tick crossing loop. Bounded at 100 iterations (subgraph guard).
    // The entire loop exists to refresh feeGrowthOutside* via RPC, so it
    // is a no-op when ENVIO_FETCH_FEE_GROWTH is off.
    if (FETCH_FEE_GROWTH && oldTick !== undefined) {
      await processTickCrossings({
        context,
        poolAddress: event.srcAddress,
        poolId,
        feeTier: pool.feeTier,
        oldTick,
        newTick,
        blockNumber: event.block.number,
        timestamp: ts,
      });
    }
  },
);

type TickWalkArgs = {
  context: EvmOnEventContext;
  poolAddress: string;
  poolId: string;
  feeTier: bigint;
  oldTick: bigint;
  newTick: bigint;
  blockNumber: number;
  timestamp: number;
};

async function processTickCrossings(args: TickWalkArgs) {
  const { context, poolAddress, poolId, feeTier, oldTick, newTick, blockNumber, timestamp } = args;
  const tickSpacing = feeTierToTickSpacing(feeTier);

  const abs = newTick >= oldTick ? newTick - oldTick : oldTick - newTick;
  const numIters = abs / tickSpacing;
  if (numIters > 100n) return;

  // If current newTick is itself a multiple of tickSpacing, include it.
  if (newTick % tickSpacing === 0n) {
    await updateTickFeeVars(context, poolAddress, poolId, newTick, blockNumber, timestamp);
  }

  const mod = ((newTick % tickSpacing) + tickSpacing) % tickSpacing;
  if (newTick > oldTick) {
    let i = oldTick + (tickSpacing - mod);
    while (i <= newTick) {
      await updateTickFeeVars(context, poolAddress, poolId, i, blockNumber, timestamp);
      i += tickSpacing;
    }
  } else if (newTick < oldTick) {
    let i = oldTick - mod;
    while (i >= newTick) {
      await updateTickFeeVars(context, poolAddress, poolId, i, blockNumber, timestamp);
      i -= tickSpacing;
    }
  }
}

async function updateTickFeeVars(
  context: TickWalkArgs["context"],
  poolAddress: string,
  poolId: string,
  tickIdx: bigint,
  blockNumber: number,
  timestamp: number,
) {
  const id = `${poolId}#${tickIdx.toString()}`;
  const tickRO = await context.Tick.get(id);
  if (!tickRO) return;

  const info = await context.effect(getPoolTickInfo, {
    address: poolAddress,
    tickIdx: Number(tickIdx),
    blockNumber,
  });
  if (!info) return;

  const tick = {
    ...tickRO,
    feeGrowthOutside0X128: BigInt(info.feeGrowthOutside0X128),
    feeGrowthOutside1X128: BigInt(info.feeGrowthOutside1X128),
  };
  context.Tick.set(tick);
  await updateTickDayData(timestamp, tick, context);

  // Suppress unused warnings — kept for parity with subgraph callsite.
  void ZERO_BD; void ZERO_BI;
}
