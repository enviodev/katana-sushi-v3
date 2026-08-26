// Pool template Collect: subgraph collects pool TVL deltas (lp fees that were
// previously accrued but not yet withdrawn). Distinct from PositionManager.Collect.
import { indexer, type Collect } from "envio";
import { getChainConfig } from "../utils/chains.js";
import { FACTORY_ADDRESS, ONE_BI } from "../utils/constants.js";
import { convertTokenToDecimal } from "../utils/index.js";
import { getTrackedAmountUSD } from "../utils/pricing.js";
import {
  updatePoolDayData,
  updatePoolHourData,
  updateTokenDayData,
  updateTokenHourData,
  updateUniswapDayData,
} from "../utils/intervalUpdates.js";
import { loadOrCreateTransaction } from "../utils/transaction.js";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "Collect", wildcard: true },
  async ({ event, context }) => {
    const cfg = getChainConfig(context.chain.id);
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

    const collected0 = convertTokenToDecimal(event.params.amount0, token0RO.decimals);
    const collected1 = convertTokenToDecimal(event.params.amount1, token1RO.decimals);
    const trackedUSD = getTrackedAmountUSD(
      bundleRO,
      collected0,
      token0RO,
      collected1,
      token1RO,
      cfg.whitelistTokens,
    );

    const newTotal0 = poolRO.totalValueLockedToken0.minus(collected0);
    const newTotal1 = poolRO.totalValueLockedToken1.minus(collected1);
    const newPoolTvlETH = newTotal0
      .times(token0RO.derivedETH)
      .plus(newTotal1.times(token1RO.derivedETH));

    const pool = {
      ...poolRO,
      txCount: poolRO.txCount + ONE_BI,
      totalValueLockedToken0: newTotal0,
      totalValueLockedToken1: newTotal1,
      totalValueLockedETH: newPoolTvlETH,
      totalValueLockedUSD: newPoolTvlETH.times(bundleRO.ethPriceUSD),
      collectedFeesToken0: poolRO.collectedFeesToken0.plus(collected0),
      collectedFeesToken1: poolRO.collectedFeesToken1.plus(collected1),
      collectedFeesUSD: poolRO.collectedFeesUSD.plus(trackedUSD),
    };
    context.Pool.set(pool);

    const token0 = {
      ...token0RO,
      txCount: token0RO.txCount + ONE_BI,
      totalValueLocked: token0RO.totalValueLocked.minus(collected0),
      totalValueLockedUSD: token0RO.totalValueLocked
        .minus(collected0)
        .times(token0RO.derivedETH)
        .times(bundleRO.ethPriceUSD),
    };
    const token1 = {
      ...token1RO,
      txCount: token1RO.txCount + ONE_BI,
      totalValueLocked: token1RO.totalValueLocked.minus(collected1),
      totalValueLockedUSD: token1RO.totalValueLocked
        .minus(collected1)
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
    const collect: Collect = {
      id: `${transaction.id}-${event.logIndex}`,
      transaction_id: transaction.id,
      timestamp: BigInt(event.block.timestamp),
      pool_id: pool.id,
      owner: event.params.owner.toLowerCase(),
      amount0: collected0,
      amount1: collected1,
      amountUSD: trackedUSD,
      tickLower: event.params.tickLower,
      tickUpper: event.params.tickUpper,
      logIndex: BigInt(event.logIndex),
    };
    context.Collect.set(collect);

    const ts = event.block.timestamp;
    await updateUniswapDayData(ts, factory, context);
    await updatePoolDayData(ts, pool, context);
    await updatePoolHourData(ts, pool, context);
    await updateTokenDayData(ts, token0, bundleRO, context);
    await updateTokenDayData(ts, token1, bundleRO, context);
    await updateTokenHourData(ts, token0, bundleRO, context);
    await updateTokenHourData(ts, token1, bundleRO, context);
  },
);
