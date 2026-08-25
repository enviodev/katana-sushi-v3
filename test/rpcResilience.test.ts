import { describe, expect, it } from "vitest";
import { BaseError, HttpRequestError, parseAbi } from "viem";

import { isRevert, withRetry } from "../src/effects/client.js";

// The pool and block that crash-looped the hosted deployment: every restart
// died on this exact Swap because the upstream RPC answered 403.
const POOL = "0x02CDD2dD00e1e0900eC03267CF16e6170ff7B05B" as const;
const BLOCK = 5652184n;

const POOL_ABI = parseAbi([
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
]);

function httpError(status: number): BaseError {
  return new HttpRequestError({ status, url: "https://example.test" });
}

describe("isRevert", () => {
  it("does not classify a 403 quota response as a revert", () => {
    expect(isRevert(httpError(403))).toBe(false);
  });

  it("does not classify a 429 throttle as a revert", () => {
    expect(isRevert(httpError(429))).toBe(false);
  });

  it("does not classify a plain network error as a revert", () => {
    expect(isRevert(new Error("socket hang up"))).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries a transient failure and then succeeds", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 3) throw httpError(429);
      return "ok";
    });
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  it("retries 403 — the failure mode that crash-looped the indexer", async () => {
    let attempts = 0;
    const result = await withRetry(async () => {
      attempts++;
      if (attempts < 2) throw httpError(403);
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(attempts).toBe(2);
  });

  // Exhausting the full backoff ladder genuinely takes several seconds, which
  // is the intended production behaviour — so this needs a wider test window
  // than vitest's 5s default.
  it("gives up and rethrows once attempts are exhausted", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw httpError(503);
      }),
    ).rejects.toThrow();
    // Must surface loudly rather than resolve to a wrong value.
    expect(attempts).toBe(Number(process.env.ENVIO_RPC_MAX_ATTEMPTS ?? 6));
  }, 30_000);

  it("does not retry a non-transient client error", async () => {
    let attempts = 0;
    await expect(
      withRetry(async () => {
        attempts++;
        throw httpError(401);
      }),
    ).rejects.toThrow();
    expect(attempts).toBe(1);
  });
});

// Live integration check. Point KATANA_TEST_DEAD_RPC at an endpoint that is
// known-bad (an exhausted key returning 403) to prove the client fails over to
// the public RPC instead of taking the indexer down. Skipped when unset so the
// suite stays runnable — and so the URL, which carries an API key, never has to
// live in the repo.
const deadRpc = process.env.KATANA_TEST_DEAD_RPC;

describe.runIf(deadRpc)("fallback transport", () => {
  it("still reads fee growth when the primary RPC is exhausted", async () => {
    process.env.ENVIO_KATANA_RPC_URL = deadRpc;
    const { getKatanaClient } = await import("../src/effects/client.js");

    const [g0, g1] = await getKatanaClient().multicall({
      contracts: [
        { address: POOL, abi: POOL_ABI, functionName: "feeGrowthGlobal0X128" },
        { address: POOL, abi: POOL_ABI, functionName: "feeGrowthGlobal1X128" },
      ],
      blockNumber: BLOCK,
      allowFailure: false,
    });

    expect(g0).toBe(47256850800820189521616389110775n);
    expect(g1).toBe(59075050318443387681314326576033n);
  }, 60_000);
});
