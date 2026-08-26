import { createTestIndexer } from "envio";
import "../src/handlers/poolCreated.js";
const CHAIN = 747474;
const POOL = "0x" + (0xc01).toString(16).padStart(40, "0");
const T0 = "0x" + (0xa01).toString(16).padStart(40, "0");
const T1 = "0x" + (0xb01).toString(16).padStart(40, "0");
const ix = createTestIndexer();
const r = await ix.process({ chains: { [CHAIN]: { simulate: [{
  contract: "UniswapV3Factory" as const, event: "PoolCreated" as const,
  block: { number: 2_000_000, timestamp: 1_699_999_988 },
  params: { token0: T0 as `0x${string}`, token1: T1 as `0x${string}`, fee: 3000n, tickSpacing: 60n, pool: POOL as `0x${string}` },
}] } } });
console.log("changes keys:", JSON.stringify(r.changes?.map((c:any)=>Object.keys(c))));
console.log("addresses.sets:", JSON.stringify((r.changes?.[0] as any)?.addresses));
console.log("chain addresses:", JSON.stringify((ix as any).chains?.[CHAIN]?.UniswapV3Pool?.addresses));
