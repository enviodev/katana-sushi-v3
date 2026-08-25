import { createEffect, S } from "envio";
import { parseAbi } from "viem";
import { RPC_RATE, getKatanaClient, isRevert, withRetry } from "./client.js";

// `ticks(tick)` returns:
//   (uint128 liquidityGross, int128 liquidityNet,
//    uint256 feeGrowthOutside0X128, uint256 feeGrowthOutside1X128,
//    int56 tickCumulativeOutside, uint160 secondsPerLiquidityOutsideX128,
//    uint32 secondsOutside, bool initialized)
const POOL_ABI = parseAbi([
  "function ticks(int24 tick) view returns (uint128, int128, uint256, uint256, int56, uint160, uint32, bool)",
]);

// Returns null when the call reverts (tick uninitialised at this block).
export const getPoolTickInfo = createEffect(
  {
    name: "getPoolTickInfo",
    input: S.schema({
      address: S.string,
      tickIdx: S.number,
      blockNumber: S.number,
    }),
    output: S.nullable(
      S.schema({
        feeGrowthOutside0X128: S.string,
        feeGrowthOutside1X128: S.string,
      }),
    ),
    cache: true,
    rateLimit: { calls: RPC_RATE.poolTickInfo, per: "second" },
  },
  async ({ input }) => {
    const client = getKatanaClient();
    try {
      const result = (await withRetry(() =>
        client.readContract({
          address: input.address as `0x${string}`,
          abi: POOL_ABI,
          functionName: "ticks",
          args: [input.tickIdx],
          blockNumber: BigInt(input.blockNumber),
        }),
      )) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, number, boolean];

      return {
        feeGrowthOutside0X128: result[2].toString(),
        feeGrowthOutside1X128: result[3].toString(),
      };
    } catch (err) {
      // An uninitialised tick reverts — that is a real answer, and maps to null.
      // A transport failure is not: persisting it as null would silently write
      // wrong fee-growth data into a cached entry, so let it propagate once
      // withRetry has given up.
      if (isRevert(err)) return null;
      throw err;
    }
  },
);
