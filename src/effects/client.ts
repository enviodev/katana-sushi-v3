import { createPublicClient, http, type Chain, type PublicClient } from "viem";

// Single Katana RPC client used by all effects.
//
// Reads ENVIO_KATANA_RPC_URL; falls back to the public Katana RPC if unset.
function buildRpcUrl(): string {
  return process.env.ENVIO_KATANA_RPC_URL || "https://rpc.katana.network";
}

// Minimal Chain definition. The multicall3 address below is the canonical
// CREATE2 deterministic deployment (same on most EVM chains). viem requires
// this set for `multicall()` to work.
const katana: Chain = {
  id: 747474,
  name: "Katana",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.katana.network"] },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
};

let cached: PublicClient | undefined;

export function getKatanaClient(): PublicClient {
  if (!cached) {
    cached = createPublicClient({
      chain: katana,
      transport: http(buildRpcUrl(), { batch: true }),
    });
  }
  return cached;
}
