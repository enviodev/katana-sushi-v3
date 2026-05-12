// Runtime feature flags read from env vars.
//
// FETCH_FEE_GROWTH controls whether the indexer makes RPC calls to fetch
// `feeGrowthGlobal*X128` (per swap/flash) and `feeGrowthOutside*X128` per
// initialized tick (per mint/burn and during swap tick crossings). These
// fields are only meaningful to downstream consumers doing LP fee accounting.
//
// Default: OFF (no RPC, those fields stay at 0n). Set ENVIO_FETCH_FEE_GROWTH=true
// to enable. Expect a >10x backfill slowdown when enabled.
export const FETCH_FEE_GROWTH =
  process.env.ENVIO_FETCH_FEE_GROWTH === "true" ||
  process.env.ENVIO_FETCH_FEE_GROWTH === "1";
