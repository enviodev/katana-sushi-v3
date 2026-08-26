/**
 * Decomposes the ~0.51 ms/event cost of the Swap handler.
 *
 * Production numbers (Prometheus, 2026-08-25 backfill): Swap is 8,386,586 of
 * 12,942,778 events and 4,315,360 ms of 6,302,573 ms of handler time — 68 %. So
 * whatever dominates inside Swap sets the ceiling on sync speed.
 *
 * This calls the exported hot-path functions against an in-memory stub context,
 * so it measures pure handler CPU: no network, no Postgres, no test harness.
 *
 *   npx tsx bench/hotPath.ts [iterations]
 */
import { BigDecimal } from "envio";

import {
  findNativePerToken,
  getTrackedAmountUSD,
  sqrtPriceX96ToTokenPrices,
} from "../src/utils/pricing.js";
import {
  updatePoolDayData,
  updatePoolHourData,
  updateTokenDayData,
  updateTokenHourData,
  updateUniswapDayData,
} from "../src/utils/intervalUpdates.js";
import { getChainConfig } from "../src/utils/chains.js";

// Verbatim copy of the pre-optimisation findNativePerToken, kept here purely as
// the A/B baseline: it awaits Token.get inside the loop, so a token in N
// whitelist pools costs N sequential awaits.
async function baselineFindNativePerToken(
  context: any,
  token: any,
  bundle: any,
  wrappedNativeAddress: string,
  stablecoinAddresses: string[],
  minimumNativeLocked: BigDecimal,
): Promise<BigDecimal> {
  const ZERO_BD_ = new BigDecimal("0");
  const ONE_BD_ = new BigDecimal("1");
  const tokenAddress = token.id;
  if (tokenAddress === wrappedNativeAddress.toLowerCase()) return ONE_BD_;
  if (stablecoinAddresses.map((a) => a.toLowerCase()).includes(tokenAddress.toLowerCase())) {
    return ONE_BD_.div(bundle.ethPriceUSD);
  }
  const pools = await Promise.all(token.whitelistPools.map((id: string) => context.Pool.get(id)));
  let largestLiquidityETH = ZERO_BD_;
  let priceSoFar = ZERO_BD_;
  for (const pool of pools as any[]) {
    if (!pool || pool.liquidity <= 0n) continue;
    if (pool.token0_id === token.id) {
      const t1 = await context.Token.get(pool.token1_id);
      if (t1) {
        const ethLocked = pool.totalValueLockedToken1.times(t1.derivedETH);
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumNativeLocked)) {
          largestLiquidityETH = ethLocked;
          priceSoFar = pool.token1Price.times(t1.derivedETH);
        }
      }
    }
    if (pool.token1_id === token.id) {
      const t0 = await context.Token.get(pool.token0_id);
      if (t0) {
        const ethLocked = pool.totalValueLockedToken0.times(t0.derivedETH);
        if (ethLocked.gt(largestLiquidityETH) && ethLocked.gt(minimumNativeLocked)) {
          largestLiquidityETH = ethLocked;
          priceSoFar = pool.token0Price.times(t0.derivedETH);
        }
      }
    }
  }
  return priceSoFar.precision(20);
}

const N = Number(process.argv[2] ?? 20_000);
const CHAIN = 747474;
const cfg = getChainConfig(CHAIN);

const ZERO = new BigDecimal("0");
const bd = (s: string) => new BigDecimal(s);
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

// Map-backed stand-in for the handler context. Every entity namespace resolves
// through the same store, which is what the preload pass effectively presents
// to the handler once rows are resident.
const store = new Map<string, any>();
const key = (kind: string, id: string) => `${kind}:${id}`;

const context: any = new Proxy(
  {},
  {
    get(_t, kind: string) {
      if (kind === "chain") return { id: CHAIN };
      return {
        get: async (id: string) => store.get(key(kind, id)),
        getOrThrow: async (id: string) => store.get(key(kind, id)),
        set: (e: any) => store.set(key(kind, e.id), e),
        deleteUnsafe: (id: string) => store.delete(key(kind, id)),
      };
    },
  },
);

function makeToken(id: string, whitelistPools: string[]) {
  return {
    id, symbol: "TKN", name: "Token", decimals: 18n, totalSupply: 0n,
    volume: ZERO, volumeUSD: ZERO, untrackedVolumeUSD: ZERO, feesUSD: ZERO,
    txCount: 0n, poolCount: 0n,
    totalValueLocked: bd("1000"), totalValueLockedUSD: bd("1000000"),
    totalValueLockedUSDUntracked: ZERO, derivedETH: bd("0.5"), whitelistPools,
  };
}

function makePool(id: string, token0_id: string, token1_id: string) {
  return {
    id, createdAtTimestamp: 1n, createdAtBlockNumber: 1n,
    token0_id, token1_id, feeTier: 3000n, liquidity: 1_000_000n,
    sqrtPrice: 79228162514264337593543950336n,
    feeGrowthGlobal0X128: 0n, feeGrowthGlobal1X128: 0n,
    token0Price: bd("1.5"), token1Price: bd("0.6666"), tick: 0n, observationIndex: 0n,
    volumeToken0: ZERO, volumeToken1: ZERO, volumeUSD: ZERO,
    untrackedVolumeUSD: ZERO, feesUSD: ZERO, txCount: 0n,
    collectedFeesToken0: ZERO, collectedFeesToken1: ZERO, collectedFeesUSD: ZERO,
    totalValueLockedToken0: bd("1000"), totalValueLockedToken1: bd("1000"),
    totalValueLockedETH: bd("1000"), totalValueLockedUSD: bd("1000000"),
    totalValueLockedUSDUntracked: ZERO, isProtocolFeeEnabled: false,
    liquidityProviderCount: 0n,
  };
}

const FACTORY = {
  id: cfg.factoryAddress ?? addr(0x203e), poolCount: 1n, txCount: 0n,
  totalVolumeUSD: ZERO, totalVolumeETH: ZERO, totalFeesUSD: ZERO, totalFeesETH: ZERO,
  untrackedVolumeUSD: ZERO, totalValueLockedUSD: ZERO, totalValueLockedETH: ZERO,
  totalValueLockedUSDUntracked: ZERO, totalValueLockedETHUntracked: ZERO,
  owner: addr(0x1),
};

const bundle = { id: "1", ethPriceUSD: bd("3000") };

async function time(label: string, iters: number, fn: (i: number) => Promise<void> | void) {
  // warm
  for (let i = 0; i < Math.min(500, iters); i++) await fn(i);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < iters; i++) await fn(i);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  const us = (ms * 1000) / iters;
  console.log(`  ${label.padEnd(42)} ${us.toFixed(2).padStart(9)} us/op   ${(1e6 / us).toFixed(0).padStart(9)} ops/s`);
  return us;
}

async function main() {
  const TOKEN0 = addr(0xa01);
  const TOKEN1 = addr(0xb01);
  const POOL = addr(0xc01);

  store.set(key("Bundle", "1"), bundle);
  store.set(key("Factory", FACTORY.id), FACTORY);

  console.log(`\niterations=${N}\n`);
  console.log("--- pure BigDecimal math (no entity access) ---");

  const t0 = makeToken(TOKEN0, []);
  const t1 = makeToken(TOKEN1, []);
  const sqrtP = 79228162514264337593543950336n;

  const usPrices = await time("sqrtPriceX96ToTokenPrices", N, () => {
    sqrtPriceX96ToTokenPrices(sqrtP, t0 as any, t1 as any);
  });
  const usTracked = await time("getTrackedAmountUSD", N, () => {
    getTrackedAmountUSD(bundle as any, bd("1.5"), t0 as any, bd("2.5"), t1 as any, cfg.whitelistTokens);
  });

  console.log("\n--- findNativePerToken: baseline (sequential) vs batched ---");
  const sizes = [0, 2, 5, 10, 20, 34];
  const fnptUs: Record<number, number> = {};
  for (const size of sizes) {
    const wl: string[] = [];
    for (let i = 0; i < size; i++) {
      const cp = addr(0xd000 + i);
      const wp = addr(0xe000 + i);
      store.set(key("Token", cp), makeToken(cp, []));
      store.set(key("Pool", wp), makePool(wp, TOKEN0, cp));
      wl.push(wp);
    }
    const tok = makeToken(TOKEN0, wl);
    store.set(key("Token", TOKEN0), tok);

    const args = [context, tok as any, bundle as any, cfg.wrappedNativeAddress, cfg.stablecoinAddresses, cfg.minimumNativeLocked] as const;

    // Equivalence check before timing — an optimisation that changes the
    // answer is worthless.
    const a = await baselineFindNativePerToken(...args);
    const b = await findNativePerToken(...args);
    if (a.toString() !== b.toString()) {
      throw new Error(`MISMATCH at ${size} pools: baseline=${a.toString()} new=${b.toString()}`);
    }

    const base = await time(`  baseline (${String(size).padStart(2)} pools)`, N, async () => {
      await baselineFindNativePerToken(...args);
    });
    fnptUs[size] = await time(`  batched  (${String(size).padStart(2)} pools)`, N, async () => {
      await findNativePerToken(...args);
    });
    console.log(`      -> ${(base / (fnptUs[size] || 1)).toFixed(2)}x faster, values match (${a.toString()})`);
  }

  console.log("\n--- interval updates (the 8 sequential awaits per Swap) ---");
  const pool = makePool(POOL, TOKEN0, TOKEN1);
  store.set(key("Pool", POOL), pool);
  store.set(key("Token", TOKEN0), makeToken(TOKEN0, []));
  store.set(key("Token", TOKEN1), makeToken(TOKEN1, []));
  const ts = 1_700_000_000;

  const usUni = await time("updateUniswapDayData", N, async () => {
    await updateUniswapDayData(ts, FACTORY as any, context);
  });
  const usPdd = await time("updatePoolDayData", N, async () => {
    await updatePoolDayData(ts, pool as any, context);
  });
  const usPhd = await time("updatePoolHourData", N, async () => {
    await updatePoolHourData(ts, pool as any, context);
  });
  const usTdd = await time("updateTokenDayData", N, async () => {
    await updateTokenDayData(ts, t0 as any, bundle as any, context);
  });
  const usThd = await time("updateTokenHourData", N, async () => {
    await updateTokenHourData(ts, t0 as any, bundle as any, context);
  });

  const intervalTotal = usUni + usPdd + usPhd + usTdd * 2 + usThd * 2;
  console.log("\n--- modelled Swap cost ---");
  for (const size of [2, 10, 20, 34]) {
    const total = usPrices + usTracked + fnptUs[size]! * 2 + intervalTotal;
    console.log(
      `  wl=${String(size).padStart(2)}  pricing=${(usPrices + usTracked).toFixed(0)}us  ` +
        `findNativePerToken x2=${(fnptUs[size]! * 2).toFixed(0)}us  ` +
        `intervals=${intervalTotal.toFixed(0)}us  ` +
        `TOTAL=${total.toFixed(0)}us -> ${(1e6 / total).toFixed(0)} events/s`,
    );
  }
  console.log("\n  (production measured: ~510 us/event, ~3,170 events/s)\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
