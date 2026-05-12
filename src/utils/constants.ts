import { BigDecimal } from "envio";

export const KATANA_CHAIN_ID = 747474;

export const ADDRESS_ZERO = "0x0000000000000000000000000000000000000000";

export const ZERO_BI = 0n;
export const ONE_BI = 1n;
export const ZERO_BD = new BigDecimal("0");
export const ONE_BD = new BigDecimal("1");

export const Q192 = 2n ** 192n;

export const FACTORY_ADDRESS = "0x203e8740894c8955cb8950759876d7e7e45e04c1";

// Defensive ceiling for BigDecimal values written to Postgres. HyperIndex maps
// BigDecimal to numeric(78, _), so anything past ~10^78 fails to insert and
// crashes the indexer. Pricing math on thinly-traded pools with skewed
// sqrtPriceX96 can cascade into multi-orders-of-magnitude values, so we clamp
// at 10^36 — well below the column limit, well above any realistic USD/price.
export const MAX_BD = new BigDecimal("1e36");
