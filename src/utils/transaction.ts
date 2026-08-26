import type { EvmOnEventContext, Transaction } from "envio";
import { ZERO_BI } from "./constants.js";

export type EventForTransaction = {
  transaction: { hash: string; gasPrice?: bigint | undefined };
  block: { number: number; timestamp: number };
};

// No read-before-write here on purpose.
//
// This used to `await context.Transaction.get(id)` solely to carry `gasUsed`
// forward, but `gasUsed` is never assigned a non-zero value anywhere in the
// indexer — it is not in `field_selection`, so there is nothing to source it
// from — which made `existing?.gasUsed ?? ZERO_BI` always ZERO_BI, identical to
// the fallback. Every other field is overwritten from the current event either
// way, so dropping the load is exactly equivalent.
//
// It was worth finding: this runs from ten handlers, i.e. on essentially every
// event, and `Transaction.get` was the single most expensive entity load in the
// indexer at 692 s of a 2,798 s sync — most of them missing, since the row
// usually does not exist yet.
export async function loadOrCreateTransaction(
  event: EventForTransaction,
  context: EvmOnEventContext,
): Promise<Transaction> {
  const tx: Transaction = {
    id: event.transaction.hash,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    gasUsed: ZERO_BI,
    gasPrice: event.transaction.gasPrice ?? ZERO_BI,
  };
  context.Transaction.set(tx);
  return tx;
}
