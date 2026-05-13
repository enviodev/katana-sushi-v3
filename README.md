# Katana SushiSwap V3 — HyperIndex v3 indexer

Port of `subgraphs/subgraphs/v3` to HyperIndex v3. Indexes Katana mainnet (chain
id 747474) only. Output schema mirrors the source subgraph entity-for-entity so
downstream consumers can swap GraphQL endpoints without changes.

## Contracts indexed

| Contract | Address | Start block |
|---|---|---|
| `UniswapV3Factory` | `0x203e8740894c8955cb8950759876d7e7e45e04c1` | 1,858,972 |
| `NonfungiblePositionManager` | `0x2659c6085d26144117d904c46b48b6d180393d27` | 1,860,127 |
| `UniswapV3Pool` (template) | dynamic | from factory |

## Setup

```sh
pnpm install
cp .env.example .env   # fill in ENVIO_API_TOKEN and ENVIO_DRPC_API_KEY
pnpm envio codegen
pnpm envio dev
```

GraphQL endpoint: `http://localhost:8080/v1/graphql`.

`ENVIO_API_TOKEN` is mandatory for HyperSync (free at <https://envio.dev>).

`ENVIO_DRPC_API_KEY` is used by the Effect API for:
- Token metadata (`name`, `symbol`, `decimals`, `totalSupply`)
- `pool.feeGrowthGlobal0X128/1X128` reads on Swap and Flash *(when `ENVIO_FETCH_FEE_GROWTH` is on, which is the default)*
- `pool.ticks(tickIdx)` reads on Mint/Burn and during swap tick crossings *(same gate)*
- `positionManager.positions(tokenId)` reads on Increase/Decrease/Collect for `feeGrowthInside*LastX128` *(same gate)*

If `ENVIO_DRPC_API_KEY` is unset, the client falls back to `ENVIO_KATANA_RPC_URL`
(or the public Katana RPC). dRPC is recommended for backfill throughput.

### Fee-growth flag

`ENVIO_FETCH_FEE_GROWTH` (**default: on**) controls whether the indexer makes
per-event RPC calls to populate the Uniswap V3 fee-growth fixed-point fields:

- `Pool.feeGrowthGlobal0X128 / 1X128`
- `Tick.feeGrowthOutside0X128 / 1X128`
- `Position.feeGrowthInside0LastX128 / 1X128`
- `PoolDayData.feeGrowthGlobal0X128 / 1X128`
- `PoolHourData.feeGrowthGlobal0X128 / 1X128`
- `TickDayData.feeGrowthOutside0X128 / 1X128`

These values are required for the standard LP-fee formula
`feeGrowthInside = feeGrowthGlobal − feeGrowthOutsideLower − feeGrowthOutsideUpper`
that consumers use to compute fees earned by a position between two blocks. All
other data — pools, swaps, mints, burns, position metadata, TVL, volume,
prices — is unaffected by this flag.

| Mode | Behavior | Backfill speed |
|---|---|---|
| Default (unset / `true`) | Fee-growth fields populated via RPC on every swap, flash, mint, burn, tick crossing, and LP NFT event. | RPC-bound |
| `ENVIO_FETCH_FEE_GROWTH=false` | Fee-growth fields stay at `0`. No RPC calls for fee growth. | ~10× faster |

### Position metadata

`Position` entities (`pool`, `token0`, `token1`, `tickLower`, `tickUpper`,
`owner`, all the deposit/withdraw/collect amounts) are derived purely from
events — no RPC. The trick: every NPM-managed mint emits a `Pool.Mint` with
`sender = NonfungiblePositionManager` *before* the corresponding
`Transfer`/`IncreaseLiquidity`. The `Mint` entity has `@index` on `transaction`,
so when an NFT event fires we look up the mint by tx hash and inherit
`pool`, `tickLower`, `tickUpper` from it. See `src/handlers/positionHelpers.ts`.

## Layout

```
hyperindex/
├── abis/                 # factory.json, pool.json, NonfungiblePositionManager.json
├── config.yaml           # v3 chains/contracts/events
├── schema.graphql        # 23 entity types (matches subgraph)
├── src/
│   ├── effects/          # viem-backed RPC effects (token metadata, fee growth, etc.)
│   ├── handlers/         # one file per event handler
│   └── utils/            # constants, chain config, pricing, intervalUpdates, tick, transaction
```

## Notes on parity with the subgraph

- `Bundle` id is `"1"` (matches subgraph). For multichain, switch to a chainId-prefixed scheme via `buildId`.
- Entity ids are unprefixed lowercase addresses (Katana-only).
- `Tick` ids are `<pool>#<tickIdx>` with a `#` separator (matches subgraph).
- `Pool.tick` is initialised to `tickSpacing` until `Initialize` fires (matches subgraph behaviour, not strictly meaningful).
- `Flash` entities are created (the subgraph mapping omits this even though the schema declares the type — we create them for query-shape parity).
- `TickHourData` is populated with minimal liquidity state (subgraph omits it entirely, but the schema declares it).
- The swap tick-crossing loop is capped at 100 iterations (matches the subgraph guard against initialisation spam).
- `stablecoinIsToken0` for the native price pool `0x105f833d...` is currently set to `false`. Verify empirically on first dev run — if `Bundle.ethPriceUSD` looks like the reciprocal of the expected ETH/USD price, flip the flag in `src/utils/chains.ts`.

## Type-checking

```sh
pnpm exec tsc --noEmit
```
