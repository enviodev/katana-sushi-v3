import { createEffect, S } from "envio";
import { parseAbi } from "viem";
import { getKatanaClient } from "./client.js";

const POOL_ABI = parseAbi([
  "function feeGrowthGlobal0X128() view returns (uint256)",
  "function feeGrowthGlobal1X128() view returns (uint256)",
]);

// Fee growth changes every block, so cache key must include block number.
// We disable the effect's general cache and let HyperIndex's per-(input)
// memoization handle deduplication within a batch.
export const getPoolFeeGrowth = createEffect(
  {
    name: "getPoolFeeGrowth",
    input: S.schema({
      address: S.string,
      blockNumber: S.number,
    }),
    output: S.schema({
      feeGrowthGlobal0X128: S.string,
      feeGrowthGlobal1X128: S.string,
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    const client = getKatanaClient();
    const address = input.address as `0x${string}`;
    const blockNumber = BigInt(input.blockNumber);

    // Two parallel readContract calls instead of multicall. viem's
    // `batch: true` on the HTTP transport still bundles these into a single
    // JSON-RPC request when they fire in the same event loop tick.
    const [g0, g1] = await Promise.all([
      client.readContract({
        address,
        abi: POOL_ABI,
        functionName: "feeGrowthGlobal0X128",
        blockNumber,
      }),
      client.readContract({
        address,
        abi: POOL_ABI,
        functionName: "feeGrowthGlobal1X128",
        blockNumber,
      }),
    ]);

    return {
      feeGrowthGlobal0X128: (g0 as bigint).toString(),
      feeGrowthGlobal1X128: (g1 as bigint).toString(),
    };
  },
);
