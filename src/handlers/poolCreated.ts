// Factory PoolCreated: bootstraps Factory/Bundle/Token/Pool entities and
// registers each new pool with the dynamic Pool contract template.
import { indexer, type Bundle, type Factory, type Pool, type Token } from "envio";
import { getChainConfig } from "../utils/chains.js";
import { ADDRESS_ZERO, FACTORY_ADDRESS, ZERO_BD, ZERO_BI } from "../utils/constants.js";
import { isAddressInList } from "../utils/index.js";
import { getTokenMetadata } from "../effects/tokenMetadata.js";

// No contractRegister here on purpose. UniswapV3Pool events are matched by
// signature across every address (`wildcard: true` on each pool handler), so
// there is nothing to register — and registering was what made this expensive.
// Each of the 5,525 pools added an indexed address and forced partition splits:
// the 2026-08-25 backfill issued 113,557 fetch queries, many returning 2-6
// events over 20M-block ranges, and stalled for ~10 minutes while ~2,500 pools
// registered at once.
//
// Safe because every UniswapV3Pool handler already returns early when the Pool
// entity is unknown, so an event from a foreign contract that happens to share
// an event signature costs one lookup and is dropped. Sampling Katana confirmed
// this is close to free: of 487 Swap logs across five block windows, 100% came
// from pools this indexer already tracks.

indexer.onEvent(
  { contract: "UniswapV3Factory", event: "PoolCreated" },
  async ({ event, context }) => {
    const chainId = context.chain.id;
    const cfg = getChainConfig(chainId);

    const factoryId = FACTORY_ADDRESS;
    const poolId = event.params.pool.toLowerCase();
    const token0Id = event.params.token0.toLowerCase();
    const token1Id = event.params.token1.toLowerCase();

    if (isAddressInList(poolId, cfg.poolsToSkip)) return;

    const [factoryRO, token0RO, token1RO, token0Meta, token1Meta] = await Promise.all([
      context.Factory.get(factoryId),
      context.Token.get(token0Id),
      context.Token.get(token1Id),
      context.effect(getTokenMetadata, { address: event.params.token0, chainId }),
      context.effect(getTokenMetadata, { address: event.params.token1, chainId }),
    ]);

    // Bootstrap Factory + Bundle on first pool.
    const factory: Factory = factoryRO
      ? { ...factoryRO, poolCount: factoryRO.poolCount + 1n }
      : {
          id: factoryId,
          poolCount: 1n,
          txCount: ZERO_BI,
          totalVolumeUSD: ZERO_BD,
          totalVolumeETH: ZERO_BD,
          totalFeesUSD: ZERO_BD,
          totalFeesETH: ZERO_BD,
          untrackedVolumeUSD: ZERO_BD,
          totalValueLockedUSD: ZERO_BD,
          totalValueLockedETH: ZERO_BD,
          totalValueLockedUSDUntracked: ZERO_BD,
          totalValueLockedETHUntracked: ZERO_BD,
          owner: ADDRESS_ZERO,
        };

    if (!factoryRO) {
      const bundle: Bundle = { id: "1", ethPriceUSD: ZERO_BD };
      context.Bundle.set(bundle);
    }

    const token0: Token = token0RO ?? {
      id: token0Id,
      symbol: token0Meta.symbol,
      name: token0Meta.name,
      decimals: BigInt(token0Meta.decimals),
      totalSupply: BigInt(token0Meta.totalSupply),
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      txCount: ZERO_BI,
      poolCount: ZERO_BI,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      derivedETH: ZERO_BD,
      whitelistPools: [],
    };

    const token1: Token = token1RO ?? {
      id: token1Id,
      symbol: token1Meta.symbol,
      name: token1Meta.name,
      decimals: BigInt(token1Meta.decimals),
      totalSupply: BigInt(token1Meta.totalSupply),
      volume: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      txCount: ZERO_BI,
      poolCount: ZERO_BI,
      totalValueLocked: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      derivedETH: ZERO_BD,
      whitelistPools: [],
    };

    const pool: Pool = {
      id: poolId,
      createdAtTimestamp: BigInt(event.block.timestamp),
      createdAtBlockNumber: BigInt(event.block.number),
      token0_id: token0.id,
      token1_id: token1.id,
      feeTier: event.params.fee,
      liquidity: ZERO_BI,
      sqrtPrice: ZERO_BI,
      feeGrowthGlobal0X128: ZERO_BI,
      feeGrowthGlobal1X128: ZERO_BI,
      token0Price: ZERO_BD,
      token1Price: ZERO_BD,
      // Subgraph stores tickSpacing as initial tick before Initialize fires.
      tick: event.params.tickSpacing,
      observationIndex: ZERO_BI,
      volumeToken0: ZERO_BD,
      volumeToken1: ZERO_BD,
      volumeUSD: ZERO_BD,
      untrackedVolumeUSD: ZERO_BD,
      feesUSD: ZERO_BD,
      txCount: ZERO_BI,
      collectedFeesToken0: ZERO_BD,
      collectedFeesToken1: ZERO_BD,
      collectedFeesUSD: ZERO_BD,
      totalValueLockedToken0: ZERO_BD,
      totalValueLockedToken1: ZERO_BD,
      totalValueLockedETH: ZERO_BD,
      totalValueLockedUSD: ZERO_BD,
      totalValueLockedUSDUntracked: ZERO_BD,
      isProtocolFeeEnabled: false,
      liquidityProviderCount: ZERO_BI,
    };

    // Update whitelist arrays so pricing.findNativePerToken can walk them.
    let updatedToken0 = token0;
    let updatedToken1 = token1;
    if (isAddressInList(token0.id, cfg.whitelistTokens)) {
      updatedToken1 = { ...token1, whitelistPools: [...token1.whitelistPools, pool.id] };
    }
    if (isAddressInList(token1.id, cfg.whitelistTokens)) {
      updatedToken0 = { ...token0, whitelistPools: [...token0.whitelistPools, pool.id] };
    }

    context.Factory.set(factory);
    context.Token.set(updatedToken0);
    context.Token.set(updatedToken1);
    context.Pool.set(pool);
  },
);
