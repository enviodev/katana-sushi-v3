// Runtime feature flags read from env vars.
//
// FETCH_FEE_GROWTH controls whether the indexer makes RPC calls to populate
// the three Uniswap V3 fee-growth fields:
//   - Pool.feeGrowthGlobal0/1X128       (refreshed on every Swap/Flash)
//   - Tick.feeGrowthOutside0/1X128      (refreshed on Mint/Burn and during
//                                        swap tick-crossings)
//   - Position.feeGrowthInside0/1LastX128 (refreshed on Increase/Decrease/Collect)
//
// These fields are required for the standard LP-fee formula
//   feeGrowthInside = feeGrowthGlobal − feeGrowthOutsideLower − feeGrowthOutsideUpper
// so consumers doing per-position fee accounting need them.
//
// Default: ON (feature-rich deployment). Set ENVIO_FETCH_FEE_GROWTH=false to
// opt out for a fast lean backfill — in that mode the three fee-growth fields
// stay at 0n.
export const FETCH_FEE_GROWTH =
  process.env.ENVIO_FETCH_FEE_GROWTH !== "false" &&
  process.env.ENVIO_FETCH_FEE_GROWTH !== "0";
