// PositionManager Transfer: updates Position.owner to the new holder.
import { indexer } from "envio";
import { loadOrCreateTransaction } from "../utils/transaction.js";
import { getOrCreatePosition, savePositionSnapshot } from "./positionHelpers.js";

indexer.onEvent(
  { contract: "NonfungiblePositionManager", event: "Transfer" },
  async ({ event, context }) => {
    const tx = await loadOrCreateTransaction(event, context);
    const initial = await getOrCreatePosition(
      context,
      event.params.tokenId,
      event,
      tx,
    );
    if (!initial) return;

    const position = { ...initial, owner: event.params.to.toLowerCase() };
    context.Position.set(position);
    savePositionSnapshot(context, position, event, tx);
  },
);
