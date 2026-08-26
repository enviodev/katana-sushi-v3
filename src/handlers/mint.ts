// Pool Mint: creates Mint entity, updates pool/factory/token TVL (no current
// fee accounting), creates/updates Tick entities, and refreshes interval data.
import { indexer, type EvmOnEventContext, type Mint, type Tick } from "envio";
import { FACTORY_ADDRESS, ONE_BI } from "../utils/constants.js";
import { calculateAmountUSD } from "../utils/pricing.js";
import { convertTokenToDecimal } from "../utils/index.js";
import {
  updatePoolDayData,
  updatePoolHourData,
  updateTickDayData,
  updateTickHourData,
  updateTokenDayData,
  updateTokenHourData,
  updateUniswapDayData,
} from "../utils/intervalUpdates.js";
import { createTick } from "../utils/tick.js";
import { loadOrCreateTransaction } from "../utils/transaction.js";
import { FETCH_FEE_GROWTH } from "../utils/flags.js";
import { getPoolTickInfo } from "../effects/poolTickInfo.js";
import { getChainConfig } from "../utils/chains.js";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "Mint", wildcard: true },
  async ({ event, context }) => {
    const poolId = event.srcAddress.toLowerCase();
    const lowerTickId = `${poolId}#${event.params.tickLower.toString()}`;
    const upperTickId = `${poolId}#${event.params.tickUpper.toString()}`;

    const [poolRO, bundleRO, factoryRO, lowerTickRO, upperTickRO] = await Promise.all([
      context.Pool.get(poolId),
      context.Bundle.get("1"),
      context.Factory.get(FACTORY_ADDRESS),
      context.Tick.get(lowerTickId),
      context.Tick.get(upperTickId),
    ]);
    if (!poolRO || !bundleRO || !factoryRO) return;

    const [token0RO, token1RO] = await Promise.all([
      context.Token.get(poolRO.token0_id),
      context.Token.get(poolRO.token1_id),
    ]);
    if (!token0RO || !token1RO) return;

    const amount0 = convertTokenToDecimal(event.params.amount0, token0RO.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1RO.decimals);
    const amountUSD = calculateAmountUSD(
      amount0,
      amount1,
      token0RO.derivedETH,
      token1RO.derivedETH,
      bundleRO.ethPriceUSD,
    );

    // Pool liquidity: only update if mint range straddles current tick.
    let newLiquidity = poolRO.liquidity;
    if (
      poolRO.tick !== undefined &&
      event.params.tickLower <= poolRO.tick &&
      event.params.tickUpper > poolRO.tick
    ) {
      newLiquidity = poolRO.liquidity + event.params.amount;
    }

    const newTotalToken0 = poolRO.totalValueLockedToken0.plus(amount0);
    const newTotalToken1 = poolRO.totalValueLockedToken1.plus(amount1);
    const newPoolTvlETH = newTotalToken0
      .times(token0RO.derivedETH)
      .plus(newTotalToken1.times(token1RO.derivedETH));

    const pool = {
      ...poolRO,
      txCount: poolRO.txCount + ONE_BI,
      liquidity: newLiquidity,
      totalValueLockedToken0: newTotalToken0,
      totalValueLockedToken1: newTotalToken1,
      totalValueLockedETH: newPoolTvlETH,
      totalValueLockedUSD: newPoolTvlETH.times(bundleRO.ethPriceUSD),
    };
    context.Pool.set(pool);

    const token0 = {
      ...token0RO,
      txCount: token0RO.txCount + ONE_BI,
      totalValueLocked: token0RO.totalValueLocked.plus(amount0),
      totalValueLockedUSD: token0RO.totalValueLocked
        .plus(amount0)
        .times(token0RO.derivedETH)
        .times(bundleRO.ethPriceUSD),
    };
    const token1 = {
      ...token1RO,
      txCount: token1RO.txCount + ONE_BI,
      totalValueLocked: token1RO.totalValueLocked.plus(amount1),
      totalValueLockedUSD: token1RO.totalValueLocked
        .plus(amount1)
        .times(token1RO.derivedETH)
        .times(bundleRO.ethPriceUSD),
    };
    context.Token.set(token0);
    context.Token.set(token1);

    const newFactoryTvlETH = factoryRO.totalValueLockedETH
      .minus(poolRO.totalValueLockedETH)
      .plus(pool.totalValueLockedETH);
    const factory = {
      ...factoryRO,
      txCount: factoryRO.txCount + ONE_BI,
      totalValueLockedETH: newFactoryTvlETH,
      totalValueLockedUSD: newFactoryTvlETH.times(bundleRO.ethPriceUSD),
    };
    context.Factory.set(factory);

    const transaction = await loadOrCreateTransaction(event, context);
    const mint: Mint = {
      id: `${transaction.id}#${pool.txCount.toString()}`,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      owner: event.params.owner.toLowerCase(),
      sender: event.params.sender.toLowerCase(),
      origin: (event.transaction.from ?? "").toLowerCase(),
      amount: event.params.amount,
      amount0,
      amount1,
      amountUSD,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      logIndex: BigInt(event.logIndex),
    };
    context.Mint.set(mint);

    // Record the first NPM-originated mint of this transaction so the position
    // handlers can find it with a keyed get instead of scanning Mint by
    // transaction. Guarded on absence to keep "first", matching the
    // `npmMints[0]` the getWhere-based code selected.
    if (mint.sender === getChainConfig(context.chain.id).positionManagerAddress.toLowerCase()) {
      const already = await context.TxNpmMint.get(transaction.id);
      if (!already) {
        context.TxNpmMint.set({
          id: transaction.id,
          pool_id: pool.id,
          tickLower: event.params.tickLower,
          tickUpper: event.params.tickUpper,
        });
      }
    }

    // Tick entities — load or initialize, then apply liquidity deltas.
    const lowerTick: Tick = lowerTickRO
      ? { ...lowerTickRO }
      : createTick(lowerTickId, event.params.tickLower, pool.id, event.block.timestamp, event.block.number);
    const upperTick: Tick = upperTickRO
      ? { ...upperTickRO }
      : createTick(upperTickId, event.params.tickUpper, pool.id, event.block.timestamp, event.block.number);

    const amt = event.params.amount;
    const newLower = {
      ...lowerTick,
      liquidityGross: lowerTick.liquidityGross + amt,
      liquidityNet: lowerTick.liquidityNet + amt,
    };
    const newUpper = {
      ...upperTick,
      liquidityGross: upperTick.liquidityGross + amt,
      liquidityNet: upperTick.liquidityNet - amt,
    };
    context.Tick.set(newLower);
    context.Tick.set(newUpper);

    // Interval updates.
    const ts = event.block.timestamp;
    await updateUniswapDayData(ts, factory, context);
    await updatePoolDayData(ts, pool, context);
    await updatePoolHourData(ts, pool, context);
    await updateTokenDayData(ts, token0, bundleRO, context);
    await updateTokenDayData(ts, token1, bundleRO, context);
    await updateTokenHourData(ts, token0, bundleRO, context);
    await updateTokenHourData(ts, token1, bundleRO, context);

    // Refresh tick fee growth via RPC, then update tick interval data.
    await refreshTickFeeVars(context, event.srcAddress, newLower, ts, event.block.number);
    await refreshTickFeeVars(context, event.srcAddress, newUpper, ts, event.block.number);
  },
);

async function refreshTickFeeVars(
  context: EvmOnEventContext,
  poolAddress: string,
  tick: Tick,
  timestamp: number,
  blockNumber: number,
) {
  let next: Tick = tick;
  if (FETCH_FEE_GROWTH) {
    const info = await context.effect(getPoolTickInfo, {
      address: poolAddress,
      tickIdx: Number(tick.tickIdx),
      blockNumber,
    });
    if (info) {
      next = {
        ...tick,
        feeGrowthOutside0X128: BigInt(info.feeGrowthOutside0X128),
        feeGrowthOutside1X128: BigInt(info.feeGrowthOutside1X128),
      };
      context.Tick.set(next);
    }
  }
  // Tick interval data still useful (liquidity changes) even without fee growth.
  await updateTickDayData(timestamp, next, context);
  await updateTickHourData(timestamp, next, context);
}
