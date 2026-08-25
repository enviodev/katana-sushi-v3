import { createEffect, S } from "envio";
import { parseAbi } from "viem";
import { RPC_RATE, getKatanaClient, isRevert, withRetry } from "./client.js";

// `positions(tokenId)` returns a 12-tuple; we only need the two fee-growth
// fields. Static metadata (token0/token1/fee/tickLower/tickUpper) is derived
// from event correlation in positionHelpers.ts — no RPC needed for that.
const POSITION_ABI = parseAbi([
  "function positions(uint256 tokenId) view returns (uint96, address, address, address, uint24, int24, int24, uint128, uint256, uint256, uint128, uint128)",
]);

// Returns null on revert. Positions can be deleted in the same block as mint
// (e.g. BancorSwap-style flows), so callers must handle null gracefully.
export const getPositionFeeGrowth = createEffect(
  {
    // Name bumped to start a fresh cache: the previous implementation swallowed
    // 403/429 as if it were a revert, so entries written while the RPC quota was
    // spent cannot be trusted. Cheap to refetch. (getPoolFeeGrowth keeps its
    // name — it threw instead of swallowing, so its large cache is clean.)
    name: "getPositionFeeGrowthV2",
    input: S.schema({
      positionManager: S.string,
      tokenId: S.string,
      blockNumber: S.number,
    }),
    output: S.nullable(
      S.schema({
        feeGrowthInside0LastX128: S.string,
        feeGrowthInside1LastX128: S.string,
      }),
    ),
    cache: true,
    rateLimit: { calls: RPC_RATE.positionFeeGrowth, per: "second" },
  },
  async ({ input }) => {
    const client = getKatanaClient();
    try {
      const r = (await withRetry(() =>
        client.readContract({
          address: input.positionManager as `0x${string}`,
          abi: POSITION_ABI,
          functionName: "positions",
          args: [BigInt(input.tokenId)],
          blockNumber: BigInt(input.blockNumber),
        }),
      )) as readonly [
        bigint, string, string, string, number,
        number, number, bigint, bigint, bigint, bigint, bigint,
      ];

      return {
        feeGrowthInside0LastX128: r[8].toString(),
        feeGrowthInside1LastX128: r[9].toString(),
      };
    } catch (err) {
      // A deleted or never-minted position reverts — a real answer, mapped to
      // null. A transport failure is not, so it must propagate rather than be
      // cached as missing fee growth.
      if (isRevert(err)) return null;
      throw err;
    }
  },
);
