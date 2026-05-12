import type { EvmOnEventContext, Transaction } from "envio";
import { ZERO_BI } from "./constants.js";

export type EventForTransaction = {
  transaction: { hash: string; gasPrice?: bigint | undefined };
  block: { number: number; timestamp: number };
};

export async function loadOrCreateTransaction(
  event: EventForTransaction,
  context: EvmOnEventContext,
): Promise<Transaction> {
  const id = event.transaction.hash;
  const existing = await context.Transaction.get(id);
  const tx: Transaction = {
    id,
    blockNumber: BigInt(event.block.number),
    timestamp: BigInt(event.block.timestamp),
    gasUsed: existing?.gasUsed ?? ZERO_BI,
    gasPrice: event.transaction.gasPrice ?? ZERO_BI,
  };
  context.Transaction.set(tx);
  return tx;
}
