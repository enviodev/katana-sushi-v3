import { BigDecimal, type Tick } from "envio";
import { ONE_BD, ZERO_BD, ZERO_BI } from "./constants.js";
import { fastExponentiation, safeDiv } from "./index.js";

export function feeTierToTickSpacing(feeTier: bigint): bigint {
  if (feeTier === 40000n) return 800n;
  if (feeTier === 20000n) return 400n;
  if (feeTier === 10000n) return 200n;
  if (feeTier === 3000n) return 60n;
  if (feeTier === 500n) return 10n;
  if (feeTier === 100n) return 1n;
  throw new Error(`Unexpected fee tier: ${feeTier}`);
}

export function createTick(
  id: string,
  tickIdx: bigint,
  poolId: string,
  timestamp: number,
  blockNumber: number,
): Tick {
  const price0 = fastExponentiation(new BigDecimal("1.0001"), tickIdx);
  return {
    id,
    tickIdx,
    pool_id: poolId,
    poolAddress: poolId,
    liquidityGross: ZERO_BI,
    liquidityNet: ZERO_BI,
    price0,
    price1: safeDiv(ONE_BD, price0),
    volumeToken0: ZERO_BD,
    volumeToken1: ZERO_BD,
    volumeUSD: ZERO_BD,
    untrackedVolumeUSD: ZERO_BD,
    feesUSD: ZERO_BD,
    collectedFeesToken0: ZERO_BD,
    collectedFeesToken1: ZERO_BD,
    collectedFeesUSD: ZERO_BD,
    createdAtTimestamp: BigInt(timestamp),
    createdAtBlockNumber: BigInt(blockNumber),
    liquidityProviderCount: ZERO_BI,
    feeGrowthOutside0X128: ZERO_BI,
    feeGrowthOutside1X128: ZERO_BI,
  };
}
