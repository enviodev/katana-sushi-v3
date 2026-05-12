// Pool Flash: subgraph only refreshes feeGrowthGlobal here. Schema declares a
// Flash entity, so we also create one for query parity.
import { indexer, type Flash } from "envio";
import { convertTokenToDecimal } from "../utils/index.js";
import { calculateAmountUSD } from "../utils/pricing.js";
import { loadOrCreateTransaction } from "../utils/transaction.js";
import { FETCH_FEE_GROWTH } from "../utils/flags.js";
import { getPoolFeeGrowth } from "../effects/poolFeeGrowth.js";

indexer.onEvent(
  { contract: "UniswapV3Pool", event: "Flash" },
  async ({ event, context }) => {
    const poolId = event.srcAddress.toLowerCase();
    const [poolRO, bundleRO] = await Promise.all([
      context.Pool.get(poolId),
      context.Bundle.get("1"),
    ]);
    if (!poolRO || !bundleRO) return;
    const [token0, token1] = await Promise.all([
      context.Token.get(poolRO.token0_id),
      context.Token.get(poolRO.token1_id),
    ]);
    if (!token0 || !token1) return;

    if (FETCH_FEE_GROWTH) {
      const fg = await context.effect(getPoolFeeGrowth, {
        address: event.srcAddress,
        blockNumber: event.block.number,
      });
      context.Pool.set({
        ...poolRO,
        feeGrowthGlobal0X128: BigInt(fg.feeGrowthGlobal0X128),
        feeGrowthGlobal1X128: BigInt(fg.feeGrowthGlobal1X128),
      });
    }

    const amount0 = convertTokenToDecimal(event.params.amount0, token0.decimals);
    const amount1 = convertTokenToDecimal(event.params.amount1, token1.decimals);
    const paid0 = convertTokenToDecimal(event.params.paid0, token0.decimals);
    const paid1 = convertTokenToDecimal(event.params.paid1, token1.decimals);
    const amountUSD = calculateAmountUSD(
      amount0,
      amount1,
      token0.derivedETH,
      token1.derivedETH,
      bundleRO.ethPriceUSD,
    );

    const tx = await loadOrCreateTransaction(event, context);
    const flash: Flash = {
      id: `${tx.id}-${event.logIndex}`,
      transaction_id: tx.id,
      timestamp: BigInt(event.block.timestamp),
      pool_id: poolId,
      sender: event.params.sender.toLowerCase(),
      recipient: event.params.recipient.toLowerCase(),
      amount0,
      amount1,
      amountUSD,
      amount0Paid: paid0,
      amount1Paid: paid1,
      logIndex: BigInt(event.logIndex),
    };
    context.Flash.set(flash);
  },
);
