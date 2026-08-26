import {
  BaseError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  createPublicClient,
  fallback,
  http,
  type Chain,
  type PublicClient,
} from "viem";

// Single Katana RPC client used by all effects.
//
// Reads ENVIO_KATANA_RPC_URL and layers the public Katana RPC underneath it as
// a fallback. A dedicated endpoint has a finite daily quota; when it is spent
// it answers every request with HTTP 403 rather than degrading gracefully, so
// without a second transport the indexer simply stops. With `fallback`, viem
// moves on to the next transport when one errors and the sync keeps running at
// reduced speed instead of crash-looping.
const PUBLIC_RPC = "https://rpc.katana.network";

function buildTransports() {
  const primary = process.env.ENVIO_KATANA_RPC_URL;
  const urls = primary ? [primary, PUBLIC_RPC] : [PUBLIC_RPC];
  return urls.map((url) => http(url, { batch: true }));
}

// Minimal Chain definition. The multicall3 address below is the canonical
// CREATE2 deterministic deployment (same on most EVM chains). viem requires
// this set for `multicall()` to work. Verified present on Katana from before
// this indexer's start_block (1858972), so historical multicalls are safe.
const katana: Chain = {
  id: 747474,
  name: "Katana",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [PUBLIC_RPC] },
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
      // Rank by observed success rate rather than fixed order. A spent key
      // answers 403 fast, so latency alone would keep it in front; weighting
      // stability demotes it automatically and spares every call a wasted
      // round-trip until its quota resets and it earns first place back.
      transport: fallback(buildTransports(), {
        rank: {
          interval: 60_000,
          sampleCount: 5,
          weights: { latency: 0.3, stability: 0.7 },
        },
      }),
    });
  }
  return cached;
}

// A contract that reverted (or returned no data) answered us truthfully: the
// call is not valid at that block. That is a real result, and callers turn it
// into `null`. Anything else — 403 quota, 429 throttle, 5xx, socket timeout —
// means we never reached the contract, and must never be recorded as data.
export function isRevert(err: unknown): boolean {
  if (!(err instanceof BaseError)) return false;
  const cause = err.walk(
    (e) =>
      e instanceof ContractFunctionRevertedError ||
      e instanceof ContractFunctionZeroDataError,
  );
  return cause !== null;
}

const RETRYABLE_STATUS = new Set([403, 408, 425, 429, 500, 502, 503, 504]);

function isRetryable(err: unknown): boolean {
  if (isRevert(err)) return false;
  if (!(err instanceof BaseError)) return true; // network/socket errors
  const status = err.walk(
    (e) => typeof (e as { status?: number }).status === "number",
  ) as { status?: number } | null;
  // No HTTP status at all means a transport-level failure (timeout, socket
  // reset) — those are worth retrying. A status we recognise as transient is
  // retryable too; anything else (400, 401 bad key) is not.
  return status?.status === undefined || RETRYABLE_STATUS.has(status.status);
}

const MAX_ATTEMPTS = Number(process.env.ENVIO_RPC_MAX_ATTEMPTS ?? 6);
const BASE_DELAY_MS = Number(process.env.ENVIO_RPC_BASE_DELAY_MS ?? 250);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Retry transient RPC failures with exponential backoff and full jitter.
//
// This is the difference between a blip and an outage: previously a single 403
// from the upstream RPC propagated out of the effect, was reported as an
// unhandled handler error, and killed the process — which then resumed from the
// same checkpoint and hit the same wall, forever. Retrying here absorbs the
// throttle; exhausting the retries still throws, so a genuine outage surfaces
// loudly instead of being silently written as missing data.
export async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === MAX_ATTEMPTS - 1) throw err;
      const ceiling = BASE_DELAY_MS * 2 ** attempt;
      await sleep(Math.random() * ceiling);
    }
  }
  throw lastErr;
}

// Per-effect call budgets. The public Katana RPC serves ~50 concurrent archive
// eth_calls cleanly and starts returning 429 above ~100, so these stay inside
// that envelope. Tunable without a code change because the right value depends
// on which endpoint is actually in front of them.
//
// tokenMetadata was 5/s and that was badly wrong. It is bounded work — one call
// per *distinct* token, and the effect is cached — so the whole chain costs
// ~5,389 calls, no quota risk at all. But pools are created in bursts, and at
// 5/s a burst queued up behind the limiter and stalled the entire indexer:
// during the 94840c0 sync, CPU fell to 0.04 cores while 223 calls sat in
// `envio_effect_queue`, twice, for about six minutes total — roughly 1,078 s
// across the run. Raising it to 50/s brings that down to ~110 s while still
// capping concurrency, and the retry/fallback in withRetry absorbs any 429.
export const RPC_RATE = {
  poolFeeGrowth: Number(process.env.ENVIO_RPC_RATE_FEE_GROWTH ?? 30),
  poolTickInfo: Number(process.env.ENVIO_RPC_RATE_TICK_INFO ?? 20),
  positionFeeGrowth: Number(process.env.ENVIO_RPC_RATE_POSITION ?? 10),
  tokenMetadata: Number(process.env.ENVIO_RPC_RATE_TOKEN_META ?? 50),
} as const;
