import { createEffect, S } from "envio";
import { parseAbi } from "viem";
import { getKatanaClient } from "./client.js";

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
    name: "getPositionFeeGrowth",
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
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getKatanaClient();
      const r = (await client.readContract({
        address: input.positionManager as `0x${string}`,
        abi: POSITION_ABI,
        functionName: "positions",
        args: [BigInt(input.tokenId)],
        blockNumber: BigInt(input.blockNumber),
      })) as readonly [
        bigint, string, string, string, number,
        number, number, bigint, bigint, bigint, bigint, bigint,
      ];

      return {
        feeGrowthInside0LastX128: r[8].toString(),
        feeGrowthInside1LastX128: r[9].toString(),
      };
    } catch {
      return null;
    }
  },
);
