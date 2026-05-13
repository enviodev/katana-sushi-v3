// Shared helpers for the NonfungiblePositionManager handlers.
//
// Position metadata (pool, tickLower, tickUpper, token0, token1) is recovered
// by correlating a Pool.Mint event with the NFT event in the *same transaction*
// — Uniswap's NPM calls pool.mint() before emitting Transfer/IncreaseLiquidity,
// so a Pool.Mint with sender=NPM is always present in the tx that first creates
// a position. This replaces the `positions(tokenId)` RPC call entirely.
//
// The `feeGrowthInside*LastX128` fields stay at zero — they would require the
// same fee-growth RPCs we've gated behind a flag, and no consumer of this
// indexer's data currently needs them.
import type { EvmOnEventContext, Position, PositionSnapshot, Transaction } from "envio";
import { getChainConfig } from "../utils/chains.js";
import { ADDRESS_ZERO, ZERO_BD, ZERO_BI } from "../utils/constants.js";
import { FETCH_FEE_GROWTH } from "../utils/flags.js";
import { getPositionFeeGrowth } from "../effects/positionFeeGrowth.js";

export type PositionEvent = {
  block: { number: number; timestamp: number };
  transaction: { hash: string; gasPrice?: bigint | undefined };
  logIndex: number;
};

export async function getOrCreatePosition(
  context: EvmOnEventContext,
  tokenId: bigint,
  event: PositionEvent,
  transaction: Transaction,
): Promise<Position | null> {
  const id = tokenId.toString();
  const existing = await context.Position.get(id);
  if (existing) return existing;

  // Find the Pool.Mint event in this transaction whose `sender` is the NPM —
  // that is the mint that created this position. NPM always calls pool.mint()
  // *before* emitting the corresponding Transfer/IncreaseLiquidity, so the
  // Mint entity is already in DB by the time we get here.
  const cfg = getChainConfig(context.chain.id);
  const npmAddress = cfg.positionManagerAddress.toLowerCase();

  const mintsInTx = await context.Mint.getWhere({
    transaction_id: { _eq: transaction.id },
  });
  const npmMints = mintsInTx.filter((m) => m.sender?.toLowerCase() === npmAddress);

  // Sequential mints in one tx (e.g. batch position creation) are matched
  // best-effort by order. The NPM increments tokenId monotonically and emits
  // Pool.Mints in the same order, so picking the first unclaimed mint usually
  // matches the first unclaimed Transfer/IncreaseLiquidity.
  const poolMint = npmMints[0];
  if (!poolMint) {
    context.log.warn(
      `No NPM Pool.Mint found in tx ${transaction.id} for position ${id} — ` +
        `position metadata cannot be derived. Skipping.`,
    );
    return null;
  }

  const pool = await context.Pool.get(poolMint.pool_id);
  if (!pool) return null;

  return {
    id,
    owner: ADDRESS_ZERO, // Transfer handler updates this to the real holder.
    pool_id: pool.id,
    token0_id: pool.token0_id,
    token1_id: pool.token1_id,
    tickLower_id: `${pool.id}#${poolMint.tickLower.toString()}`,
    tickUpper_id: `${pool.id}#${poolMint.tickUpper.toString()}`,
    liquidity: ZERO_BI,
    depositedToken0: ZERO_BD,
    depositedToken1: ZERO_BD,
    withdrawnToken0: ZERO_BD,
    withdrawnToken1: ZERO_BD,
    collectedToken0: ZERO_BD,
    collectedToken1: ZERO_BD,
    collectedFeesToken0: ZERO_BD,
    collectedFeesToken1: ZERO_BD,
    amountDepositedUSD: ZERO_BD,
    amountWithdrawnUSD: ZERO_BD,
    amountCollectedUSD: ZERO_BD,
    transaction_id: transaction.id,
    // feeGrowthInside is intentionally left at zero — see file header.
    feeGrowthInside0LastX128: ZERO_BI,
    feeGrowthInside1LastX128: ZERO_BI,
  };
}

// Refresh feeGrowthInside0/1LastX128 via RPC. Gated on ENVIO_FETCH_FEE_GROWTH
// (default on) — when disabled, the fields stay at whatever they were set to
// on Position creation (typically zero).
export async function updateFeeVars(
  context: EvmOnEventContext,
  position: Position,
  tokenId: bigint,
  blockNumber: number,
): Promise<Position> {
  if (!FETCH_FEE_GROWTH) return position;
  const cfg = getChainConfig(context.chain.id);
  const info = await context.effect(getPositionFeeGrowth, {
    positionManager: cfg.positionManagerAddress,
    tokenId: tokenId.toString(),
    blockNumber,
  });
  if (!info) return position;
  return {
    ...position,
    feeGrowthInside0LastX128: BigInt(info.feeGrowthInside0LastX128),
    feeGrowthInside1LastX128: BigInt(info.feeGrowthInside1LastX128),
  };
}

export function savePositionSnapshot(
  context: EvmOnEventContext,
  position: Position,
  event: PositionEvent,
  transaction: Transaction,
): void {
  const snapshot: PositionSnapshot = {
    id: `${position.id}#${event.block.number.toString()}`,
    owner: position.owner,
    pool_id: position.pool_id,
    position_id: position.id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    liquidity: position.liquidity,
    depositedToken0: position.depositedToken0,
    depositedToken1: position.depositedToken1,
    withdrawnToken0: position.withdrawnToken0,
    withdrawnToken1: position.withdrawnToken1,
    collectedFeesToken0: position.collectedFeesToken0,
    collectedFeesToken1: position.collectedFeesToken1,
    transaction_id: transaction.id,
    feeGrowthInside0LastX128: position.feeGrowthInside0LastX128,
    feeGrowthInside1LastX128: position.feeGrowthInside1LastX128,
  };
  context.PositionSnapshot.set(snapshot);
}
