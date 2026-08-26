// Pool Burn: subgraph deliberately does NOT adjust TVL here — Collect does.
// We only adjust pool liquidity (if in range) and tick entities.
import { indexer, type Burn } from "envio";
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
import { loadOrCreateTransaction } from "../utils/transaction.js";
import { FETCH_FEE_GROWTH } from "../utils/flags.js";
import { getPoolTickInfo } from "../effects/poolTickInfo.js";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "Burn", wildcard: true },
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

    let newLiquidity = poolRO.liquidity;
    if (
      poolRO.tick !== undefined &&
      event.params.tickLower <= poolRO.tick &&
      event.params.tickUpper > poolRO.tick
    ) {
      newLiquidity = poolRO.liquidity - event.params.amount;
    }

    const pool = {
      ...poolRO,
      txCount: poolRO.txCount + ONE_BI,
      liquidity: newLiquidity,
    };
    context.Pool.set(pool);

    const factory = { ...factoryRO, txCount: factoryRO.txCount + ONE_BI };
    context.Factory.set(factory);
    context.Token.set({ ...token0RO, txCount: token0RO.txCount + ONE_BI });
    context.Token.set({ ...token1RO, txCount: token1RO.txCount + ONE_BI });

    const transaction = await loadOrCreateTransaction(event, context);
    const burn: Burn = {
      id: `${transaction.id}-${event.logIndex}`,
      transaction_id: transaction.id,
      timestamp: transaction.timestamp,
      pool_id: pool.id,
      token0_id: pool.token0_id,
      token1_id: pool.token1_id,
      owner: event.params.owner.toLowerCase(),
      origin: (event.transaction.from ?? "").toLowerCase(),
      amount: event.params.amount,
      amount0,
      amount1,
      amountUSD,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      logIndex: BigInt(event.logIndex),
    };
    context.Burn.set(burn);

    // Tick updates (only if ticks already exist).
    if (lowerTickRO && upperTickRO) {
      const amt = event.params.amount;
      const newLower = {
        ...lowerTickRO,
        liquidityGross: lowerTickRO.liquidityGross - amt,
        liquidityNet: lowerTickRO.liquidityNet - amt,
      };
      const newUpper = {
        ...upperTickRO,
        liquidityGross: upperTickRO.liquidityGross - amt,
        liquidityNet: upperTickRO.liquidityNet + amt,
      };
      context.Tick.set(newLower);
      context.Tick.set(newUpper);

      const ts = event.block.timestamp;
      let tickLowerFinal = newLower;
      let tickUpperFinal = newUpper;
      if (FETCH_FEE_GROWTH) {
        const [info0, info1] = await Promise.all([
          context.effect(getPoolTickInfo, {
            address: event.srcAddress,
            tickIdx: Number(newLower.tickIdx),
            blockNumber: event.block.number,
          }),
          context.effect(getPoolTickInfo, {
            address: event.srcAddress,
            tickIdx: Number(newUpper.tickIdx),
            blockNumber: event.block.number,
          }),
        ]);
        if (info0) {
          tickLowerFinal = {
            ...newLower,
            feeGrowthOutside0X128: BigInt(info0.feeGrowthOutside0X128),
            feeGrowthOutside1X128: BigInt(info0.feeGrowthOutside1X128),
          };
          context.Tick.set(tickLowerFinal);
        }
        if (info1) {
          tickUpperFinal = {
            ...newUpper,
            feeGrowthOutside0X128: BigInt(info1.feeGrowthOutside0X128),
            feeGrowthOutside1X128: BigInt(info1.feeGrowthOutside1X128),
          };
          context.Tick.set(tickUpperFinal);
        }
      }
      await updateTickDayData(ts, tickLowerFinal, context);
      await updateTickDayData(ts, tickUpperFinal, context);
      await updateTickHourData(ts, tickLowerFinal, context);
      await updateTickHourData(ts, tickUpperFinal, context);
    }

    const ts = event.block.timestamp;
    await updateUniswapDayData(ts, factory, context);
    await updatePoolDayData(ts, pool, context);
    await updatePoolHourData(ts, pool, context);
    await updateTokenDayData(ts, token0RO, bundleRO, context);
    await updateTokenDayData(ts, token1RO, bundleRO, context);
    await updateTokenHourData(ts, token0RO, bundleRO, context);
    await updateTokenHourData(ts, token1RO, bundleRO, context);
  },
);
