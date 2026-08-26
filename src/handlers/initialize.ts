// Pool Initialize: sets sqrtPrice/tick on the pool, recomputes ETH/USD price
// and derivedETH for both tokens, and seeds hourly/daily snapshots.
import { indexer } from "envio";
import { getChainConfig } from "../utils/chains.js";
import {
  findNativePerToken,
  getNativePriceInUSD,
} from "../utils/pricing.js";
import {
  updatePoolDayData,
  updatePoolHourData,
} from "../utils/intervalUpdates.js";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "Initialize", wildcard: true },
  async ({ event, context }) => {
    const chainId = context.chain.id;
    const cfg = getChainConfig(chainId);
    const poolId = event.srcAddress.toLowerCase();

    const poolRO = await context.Pool.get(poolId);
    if (!poolRO) return;

    const pool = {
      ...poolRO,
      sqrtPrice: event.params.sqrtPriceX96,
      tick: event.params.tick,
    };
    context.Pool.set(pool);

    const bundleRO = await context.Bundle.get("1");
    if (!bundleRO) return;
    const ethPriceUSD = await getNativePriceInUSD(
      context,
      cfg.stablecoinWrappedNativePoolId,
      cfg.stablecoinIsToken0,
    );
    const bundle = { ...bundleRO, ethPriceUSD };
    context.Bundle.set(bundle);

    await updatePoolDayData(event.block.timestamp, pool, context);
    await updatePoolHourData(event.block.timestamp, pool, context);

    const [t0RO, t1RO] = await Promise.all([
      context.Token.get(pool.token0_id),
      context.Token.get(pool.token1_id),
    ]);
    if (!t0RO || !t1RO) return;

    const [derived0, derived1] = await Promise.all([
      findNativePerToken(context, t0RO, bundle, cfg.wrappedNativeAddress, cfg.stablecoinAddresses, cfg.minimumNativeLocked),
      findNativePerToken(context, t1RO, bundle, cfg.wrappedNativeAddress, cfg.stablecoinAddresses, cfg.minimumNativeLocked),
    ]);

    context.Token.set({ ...t0RO, derivedETH: derived0 });
    context.Token.set({ ...t1RO, derivedETH: derived1 });
  },
);
