// Flips pool.isProtocolFeeEnabled and records a SetProtocolFeeEvent.
import { indexer, type SetProtocolFeeEvent } from "envio";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "SetFeeProtocol" },
  async ({ event, context }) => {
    const poolId = event.srcAddress.toLowerCase();
    const poolRO = await context.Pool.get(poolId);
    if (!poolRO) return;

    context.Pool.set({
      ...poolRO,
      isProtocolFeeEnabled:
        event.params.feeProtocol0New > 0n || event.params.feeProtocol1New > 0n,
    });

    const id = `${event.transaction.hash}-${event.logIndex}`;
    const ev: SetProtocolFeeEvent = {
      id,
      pool_id: poolId,
      logIndex: BigInt(event.logIndex),
      new0: event.params.feeProtocol0New,
      new1: event.params.feeProtocol1New,
      old0: event.params.feeProtocol0Old,
      old1: event.params.feeProtocol1Old,
      timestamp: BigInt(event.block.timestamp),
    };
    context.SetProtocolFeeEvent.set(ev);
  },
);
