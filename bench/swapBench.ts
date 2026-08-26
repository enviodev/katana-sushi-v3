/**
 * Throughput benchmark for the Swap hot path.
 *
 * Swap is 8.39M of the 12.94M events in a full Katana backfill and ~68% of
 * handler time, so it sets the ceiling on sync speed. This drives the real
 * handlers through `createTestIndexer()` with simulated events, so there is no
 * network, no Postgres and no HyperSync token involved — what it measures is
 * the CPU cost of the handler path itself.
 *
 *   npx tsx bench/swapBench.ts [numSwaps] [whitelistPoolsPerToken]
 *
 * Profile it with:
 *   node --cpu-prof --cpu-prof-dir=./bench/prof \
 *     node_modules/.bin/tsx bench/swapBench.ts 20000 20
 */
import { BigDecimal, createTestIndexer } from "envio";

// Registering the handlers is a side effect of importing them.
import "../src/handlers/swap.js";
import "../src/handlers/poolCreated.js";
import "../src/handlers/mint.js";
import "../src/handlers/burn.js";

const CHAIN = 747474;
const FACTORY = "0x203e8740894c8955cb8950759876d7e7e45e04c1";

const NUM_SWAPS = Number(process.argv[2] ?? 20_000);
const WL_POOLS = Number(process.argv[3] ?? 20);

const ZERO = new BigDecimal("0");
const bd = (s: string) => new BigDecimal(s);

const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

// Two non-stablecoin, non-wrapped-native tokens, so findNativePerToken takes
// the full whitelistPools scan rather than its short-circuit.
const TOKEN0 = addr(0xa01);
const TOKEN1 = addr(0xb01);
const POOL = addr(0xc01);

function makeToken(id: string, whitelistPools: string[]) {
  return {
    chainId: CHAIN,
    id,
    symbol: "TKN",
    name: "Token",
    decimals: 18n,
    totalSupply: 0n,
    volume: ZERO,
    volumeUSD: ZERO,
    untrackedVolumeUSD: ZERO,
    feesUSD: ZERO,
    txCount: 0n,
    poolCount: 0n,
    totalValueLocked: bd("1000"),
    totalValueLockedUSD: bd("1000000"),
    totalValueLockedUSDUntracked: ZERO,
    derivedETH: bd("0.5"),
    whitelistPools,
  };
}

function makePool(id: string, token0_id: string, token1_id: string) {
  return {
    chainId: CHAIN,
    id,
    createdAtTimestamp: 1n,
    createdAtBlockNumber: 1n,
    token0_id,
    token1_id,
    feeTier: 3000n,
    liquidity: 1_000_000n,
    sqrtPrice: 79228162514264337593543950336n,
    feeGrowthGlobal0X128: 0n,
    feeGrowthGlobal1X128: 0n,
    token0Price: bd("1"),
    token1Price: bd("1"),
    tick: 0n,
    observationIndex: 0n,
    volumeToken0: ZERO,
    volumeToken1: ZERO,
    volumeUSD: ZERO,
    untrackedVolumeUSD: ZERO,
    feesUSD: ZERO,
    txCount: 0n,
    collectedFeesToken0: ZERO,
    collectedFeesToken1: ZERO,
    collectedFeesUSD: ZERO,
    totalValueLockedToken0: bd("1000"),
    totalValueLockedToken1: bd("1000"),
    totalValueLockedETH: bd("1000"),
    totalValueLockedUSD: bd("1000000"),
    totalValueLockedUSDUntracked: ZERO,
    isProtocolFeeEnabled: false,
    liquidityProviderCount: 0n,
  };
}

async function main() {
  const indexer = createTestIndexer();

  // UniswapV3Pool is an addressless (factory-registered) contract, so a
  // simulated Swap is filtered out until the pool address is registered. One
  // PoolCreated does that via contractRegister. Its handler also resolves token
  // metadata over RPC — these addresses have no code, so each read returns
  // ZeroData, which the effect maps to a fallback without retrying. That is a
  // handful of one-off requests, outside the timed region. Every entity it
  // writes is overwritten below with controlled values.
  await indexer.process({
    chains: {
      [CHAIN]: {
        simulate: [
          {
            contract: "UniswapV3Factory" as const,
            event: "PoolCreated" as const,
            block: { number: 2_000_000, timestamp: 1_699_999_988 },
            params: {
              token0: TOKEN0 as `0x${string}`,
              token1: TOKEN1 as `0x${string}`,
              fee: 3000n,
              tickSpacing: 60n,
              pool: POOL as `0x${string}`,
            },
          },
        ],
      },
    },
  });

  indexer.Factory.set({
    chainId: CHAIN,
    id: FACTORY,
    poolCount: 1n,
    txCount: 0n,
    totalVolumeUSD: ZERO,
    totalVolumeETH: ZERO,
    totalFeesUSD: ZERO,
    totalFeesETH: ZERO,
    untrackedVolumeUSD: ZERO,
    totalValueLockedUSD: ZERO,
    totalValueLockedETH: ZERO,
    totalValueLockedUSDUntracked: ZERO,
    totalValueLockedETHUntracked: ZERO,
    owner: FACTORY,
  });
  indexer.Bundle.set({ chainId: CHAIN, id: "1", ethPriceUSD: bd("3000") });

  // The whitelist pools that findNativePerToken will walk, each with its own
  // counterpart token (the loop does a Token.get per pool).
  const wlPoolIds: string[] = [];
  for (let i = 0; i < WL_POOLS; i++) {
    const counterpart = addr(0xd000 + i);
    const wlPool = addr(0xe000 + i);
    indexer.Token.set(makeToken(counterpart, []));
    indexer.Pool.set(makePool(wlPool, TOKEN0, counterpart));
    wlPoolIds.push(wlPool);
  }

  indexer.Token.set(makeToken(TOKEN0, wlPoolIds));
  indexer.Token.set(makeToken(TOKEN1, wlPoolIds));
  indexer.Pool.set(makePool(POOL, TOKEN0, TOKEN1));

  const simulate = Array.from({ length: NUM_SWAPS }, (_, i) => ({
    contract: "UniswapV3Pool" as const,
    event: "Swap" as const,
    srcAddress: POOL as `0x${string}`,
    block: { number: 2_000_001 + i, timestamp: 1_700_000_000 + i * 12 },
    params: {
      sender: TOKEN0 as `0x${string}`,
      recipient: TOKEN1 as `0x${string}`,
      amount0: 1_000_000_000_000_000_000n,
      amount1: -1_000_000_000_000_000_000n,
      sqrtPriceX96: 79228162514264337593543950336n,
      liquidity: 1_000_000n,
      tick: 0n,
    },
  }));

  // Warm the JIT so the measured run is steady-state.
  await indexer.process({ chains: { [CHAIN]: { simulate: simulate.slice(0, 200) } } });

  const t0 = process.hrtime.bigint();
  await indexer.process({ chains: { [CHAIN]: { simulate } } });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  const rate = (NUM_SWAPS / ms) * 1000;
  console.log(
    `swaps=${NUM_SWAPS}  whitelistPools/token=${WL_POOLS}  ` +
      `${ms.toFixed(0)}ms  ${rate.toFixed(0)} events/sec  ` +
      `${((ms * 1000) / NUM_SWAPS).toFixed(1)}us/event`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
