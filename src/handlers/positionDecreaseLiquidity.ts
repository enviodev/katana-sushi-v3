import { indexer, type DecreaseEvent } from "envio";
import { calculateAmountUSD } from "../utils/pricing.js";
import { convertTokenToDecimal } from "../utils/index.js";
import { loadOrCreateTransaction } from "../utils/transaction.js";
import {
  getOrCreatePosition,
  savePositionSnapshot,
} from "./positionHelpers.js";

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "DecreaseLiquidity" },
  async ({ event, context }) => {
    const tx = await loadOrCreateTransaction(event, context);
    const tokenId = event.params.tokenId;

    const initial = await getOrCreatePosition(context, tokenId, event, tx);
    if (!initial) return;

    const [bundle, token0, token1] = await Promise.all([
      context.Bundle.get("1"),
      context.Token.get(initial.token0_id),
      context.Token.get(initial.token1_id),
    ]);
    if (!bundle || !token0 || !token1) return;

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);
    const newWithdrawUSD = calculateAmountUSD(
      amount0,
      amount1,
      token0.derivedETH,
      token1.derivedETH,
      bundle.ethPriceUSD,
    );

    const position = {
      ...initial,
      liquidity: initial.liquidity - event.params.liquidity,
      withdrawnToken0: initial.withdrawnToken0.plus(amount0),
      withdrawnToken1: initial.withdrawnToken1.plus(amount1),
      amountWithdrawnUSD: initial.amountWithdrawnUSD.plus(newWithdrawUSD),
    };
    context.Position.set(position);

    const decrease: DecreaseEvent = {
      id: `${event.transaction.hash}:${event.logIndex}`,
      transaction_id: tx.id,
      timeStamp: BigInt(event.block.timestamp),
      amount0: event.params.amount0,
      amount1: event.params.amount1,
      pool_id: position.pool_id,
      token0_id: position.token0_id,
      token1_id: position.token1_id,
      position_id: position.id,
      tokenID: tokenId,
    };
    context.DecreaseEvent.set(decrease);

    savePositionSnapshot(context, position, event, tx);
  },
);
