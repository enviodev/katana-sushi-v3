import { describe, expect, it } from "vitest";
import { BigDecimal } from "envio";

import {
  bigDecimalAbs,
  exponentToBigDecimal,
  isAddressInList,
} from "../src/utils/index.js";
import {
  findNativePerToken,
  sqrtPriceX96ToTokenPrices,
} from "../src/utils/pricing.js";

// These helpers sit on the Swap path, which is 8.39M of the 12.94M events in a
// full backfill. They were rewritten for speed (memoisation, hoisted constants,
// batched loads), so what matters is that the values did not move.

describe("exponentToBigDecimal (memoised)", () => {
  it("returns the right power of ten", () => {
    expect(exponentToBigDecimal(0n).toString()).toBe("1");
    expect(exponentToBigDecimal(6n).toString()).toBe("1000000");
    expect(exponentToBigDecimal(18n).toString()).toBe("1000000000000000000");
  });

  it("returns an equal value on the cached second call", () => {
    const a = exponentToBigDecimal(18n);
    const b = exponentToBigDecimal(18n);
    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe("1000000000000000000");
  });

  it("does not let a mutation of one result corrupt the cache", () => {
    const first = exponentToBigDecimal(8n);
    // BigDecimal ops return new instances, so arithmetic must not disturb
    // the cached entry.
    first.times(new BigDecimal("3"));
    expect(exponentToBigDecimal(8n).toString()).toBe("100000000");
  });
});

describe("isAddressInList (Set-cached)", () => {
  const list = ["0xAAA1", "0xbbb2", "0xCcC3"];

  it("matches case-insensitively in both directions", () => {
    expect(isAddressInList("0xaaa1", list)).toBe(true);
    expect(isAddressInList("0xAAA1", list)).toBe(true);
    expect(isAddressInList("0xBBB2", list)).toBe(true);
    expect(isAddressInList("0xccc3", list)).toBe(true);
  });

  it("rejects absent addresses", () => {
    expect(isAddressInList("0xdddd", list)).toBe(false);
    expect(isAddressInList("", list)).toBe(false);
  });

  it("is stable across repeated calls on the same array (cache reuse)", () => {
    for (let i = 0; i < 5; i++) {
      expect(isAddressInList("0xaaa1", list)).toBe(true);
      expect(isAddressInList("0xzzzz", list)).toBe(false);
    }
  });

  it("keeps separate arrays separate", () => {
    const other = ["0xffff"];
    expect(isAddressInList("0xffff", other)).toBe(true);
    expect(isAddressInList("0xffff", list)).toBe(false);
    expect(isAddressInList("0xaaa1", other)).toBe(false);
  });
});

describe("bigDecimalAbs", () => {
  it("negates negatives and leaves positives alone", () => {
    expect(bigDecimalAbs(new BigDecimal("-1.5")).toString()).toBe("1.5");
    expect(bigDecimalAbs(new BigDecimal("1.5")).toString()).toBe("1.5");
    expect(bigDecimalAbs(new BigDecimal("0")).toString()).toBe("0");
  });
});

describe("sqrtPriceX96ToTokenPrices (hoisted Q192)", () => {
  it("prices 1:1 at 2^96 for equal decimals", () => {
    const q96 = 79228162514264337593543950336n;
    const t = { decimals: 18n } as any;
    const [p0, p1] = sqrtPriceX96ToTokenPrices(q96, t, t);
    expect(p1.toString()).toBe("1");
    expect(p0.toString()).toBe("1");
  });

  it("accounts for differing decimals", () => {
    const q96 = 79228162514264337593543950336n;
    const [, p1] = sqrtPriceX96ToTokenPrices(q96, { decimals: 18n } as any, { decimals: 6n } as any);
    expect(p1.toString()).toBe("1000000000000");
  });
});

// findNativePerToken now batches its counterpart-token loads instead of
// awaiting inside the loop. Same pools, same order, same comparisons — this
// pins the selection behaviour that the batching must not change.
describe("findNativePerToken (batched loads)", () => {
  const ZERO = new BigDecimal("0");
  const bd = (s: string) => new BigDecimal(s);
  const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");

  const TOKEN = addr(0xa01);
  const WRAPPED = addr(0x111);

  function ctx(pools: Record<string, any>, tokens: Record<string, any>) {
    return {
      Pool: { get: async (id: string) => pools[id] },
      Token: { get: async (id: string) => tokens[id] },
    } as any;
  }

  function pool(id: string, t0: string, t1: string, tvl0: string, tvl1: string, p0: string, p1: string) {
    return {
      id, token0_id: t0, token1_id: t1, liquidity: 1_000n,
      totalValueLockedToken0: bd(tvl0), totalValueLockedToken1: bd(tvl1),
      token0Price: bd(p0), token1Price: bd(p1),
    };
  }

  const bundle = { ethPriceUSD: bd("3000") } as any;
  const minLocked = bd("0.5");

  it("picks the pool with the most ETH locked, not merely the first eligible", () => {
    const small = addr(0xe1);
    const big = addr(0xe2);
    const cpSmall = addr(0xd1);
    const cpBig = addr(0xd2);

    const pools = {
      [small]: pool(small, TOKEN, cpSmall, "0", "10", "0", "2"),
      [big]: pool(big, TOKEN, cpBig, "0", "500", "0", "7"),
    };
    const tokens = {
      [cpSmall]: { derivedETH: bd("1") },
      [cpBig]: { derivedETH: bd("1") },
    };
    const token = { id: TOKEN, whitelistPools: [small, big] } as any;

    return findNativePerToken(ctx(pools, tokens), token, bundle, WRAPPED, [], minLocked).then((r) => {
      // big pool: ethLocked 500 > small pool's 10, so price comes from `big`.
      expect(r.toString()).toBe("7");
    });
  });

  it("ignores pools below minimumNativeLocked", () => {
    const tiny = addr(0xe3);
    const cp = addr(0xd3);
    const pools = { [tiny]: pool(tiny, TOKEN, cp, "0", "0.1", "0", "9") };
    const tokens = { [cp]: { derivedETH: bd("1") } };
    const token = { id: TOKEN, whitelistPools: [tiny] } as any;
    return findNativePerToken(ctx(pools, tokens), token, bundle, WRAPPED, [], minLocked).then((r) => {
      expect(r.toString()).toBe("0");
    });
  });

  it("skips zero-liquidity pools", () => {
    const dead = addr(0xe4);
    const cp = addr(0xd4);
    const p = pool(dead, TOKEN, cp, "0", "999", "0", "5");
    p.liquidity = 0n;
    const tokens = { [cp]: { derivedETH: bd("1") } };
    const token = { id: TOKEN, whitelistPools: [dead] } as any;
    return findNativePerToken(ctx({ [dead]: p }, tokens), token, bundle, WRAPPED, [], minLocked).then((r) => {
      expect(r.toString()).toBe("0");
    });
  });

  it("returns 0 with no whitelist pools, and 1 for the wrapped native token", async () => {
    const none = { id: TOKEN, whitelistPools: [] } as any;
    expect((await findNativePerToken(ctx({}, {}), none, bundle, WRAPPED, [], minLocked)).toString()).toBe("0");

    const native = { id: WRAPPED, whitelistPools: [] } as any;
    expect((await findNativePerToken(ctx({}, {}), native, bundle, WRAPPED, [], minLocked)).toString()).toBe("1");
  });

  it("handles a token that is token1 of the pool", async () => {
    const p = addr(0xe5);
    const cp = addr(0xd5);
    const pools = { [p]: pool(p, cp, TOKEN, "500", "0", "4", "0") };
    const tokens = { [cp]: { derivedETH: bd("1") } };
    const token = { id: TOKEN, whitelistPools: [p] } as any;
    const r = await findNativePerToken(ctx(pools, tokens), token, bundle, WRAPPED, [], minLocked);
    expect(r.toString()).toBe("4");
  });

  it("tolerates a missing pool or missing counterpart token", async () => {
    const p = addr(0xe6);
    const token = { id: TOKEN, whitelistPools: [p, addr(0xe7)] } as any;
    // pool present but counterpart token absent
    const pools = { [p]: pool(p, TOKEN, addr(0xd6), "0", "500", "0", "3") };
    const r = await findNativePerToken(ctx(pools, {}), token, bundle, WRAPPED, [], minLocked);
    expect(r.toString()).toBe("0");
  });
});
