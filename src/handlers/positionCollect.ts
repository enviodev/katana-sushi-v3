// PositionManager Collect (NOT Pool Collect — different signature).
// Subgraph formula: collectedFeesToken = collectedToken - withdrawnToken.
import { indexer } from "envio";
import { calculateAmountUSD } from "../utils/pricing.js";
import { convertTokenToDecimal } from "../utils/index.js";
import { loadOrCreateTransaction } from "../utils/transaction.js";
import {
  getOrCreatePosition,
  savePositionSnapshot,
  updateFeeVars,
} from "./positionHelpers.js";

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Collect" },
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

    const newCollected0 = initial.collectedToken0.plus(amount0);
    const newCollected1 = initial.collectedToken1.plus(amount1);

    const newCollectUSD = calculateAmountUSD(
      amount0,
      amount1,
      token0.derivedETH,
      token1.derivedETH,
      bundle.ethPriceUSD,
    );

    let position = {
      ...initial,
      collectedToken0: newCollected0,
      collectedToken1: newCollected1,
      collectedFeesToken0: newCollected0.minus(initial.withdrawnToken0),
      collectedFeesToken1: newCollected1.minus(initial.withdrawnToken1),
      amountCollectedUSD: initial.amountCollectedUSD.plus(newCollectUSD),
    };
    position = await updateFeeVars(context, position, tokenId, event.block.number);
    context.Position.set(position);
    savePositionSnapshot(context, position, event, tx);
  },
);
