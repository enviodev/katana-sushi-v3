import { createEffect, S } from "envio";
import { parseAbi } from "viem";
import { RPC_RATE, getKatanaClient, withRetry } from "./client.js";

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
    // This is the highest-volume effect in the indexer — roughly one call per
    // Swap and per Flash across all of chain history. Left unlimited it opened
    // thousands of concurrent eth_calls, which exhausted the endpoint's daily
    // quota and then hard-failed every request.
    rateLimit: { calls: RPC_RATE.poolFeeGrowth, per: "second" },
  },
  async ({ input }) => {
    const client = getKatanaClient();
    const address = input.address as `0x${string}`;
    const blockNumber = BigInt(input.blockNumber);

    // One multicall3 aggregate instead of two eth_calls. viem's `batch: true`
    // already bundled the two reads into a single HTTP request, but upstream
    // providers meter per JSON-RPC method, not per HTTP body — so this halves
    // the metered cost of the indexer's hottest path. multicall3 is deployed on
    // Katana well before this indexer's start_block, so historical reads are safe.
    const [g0, g1] = await withRetry(() =>
      client.multicall({
        contracts: [
          { address, abi: POOL_ABI, functionName: "feeGrowthGlobal0X128" },
          { address, abi: POOL_ABI, functionName: "feeGrowthGlobal1X128" },
        ],
        blockNumber,
        allowFailure: false,
      }),
    );

    return {
      feeGrowthGlobal0X128: (g0 as bigint).toString(),
      feeGrowthGlobal1X128: (g1 as bigint).toString(),
    };
  },
);
