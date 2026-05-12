import { BigDecimal } from "envio";
import { KATANA_CHAIN_ID } from "./constants.js";

export type NativeTokenDetails = {
  symbol: string;
  name: string;
  decimals: bigint;
};

export type StaticTokenDefinition = {
  address: string;
  symbol: string;
  name: string;
  decimals: bigint;
};

export type ChainConfig = {
  factoryAddress: string;
  positionManagerAddress: string;
  wrappedNativeAddress: string;
  stablecoinWrappedNativePoolId: string;
  // true if the stablecoin (USDC) is token0 in the native price pool.
  // The Katana WETH/USDC pool needs to be verified empirically (see README).
  stablecoinIsToken0: boolean;
  minimumNativeLocked: BigDecimal;
  stablecoinAddresses: string[];
  whitelistTokens: string[];
  tokenOverrides: StaticTokenDefinition[];
  poolsToSkip: string[];
  nativeTokenDetails: NativeTokenDetails;
};

// Lowercased Katana addresses, taken verbatim from
// subgraphs/config/katana.js (v3 section).
const NATIVE_ADDRESS = "0xee7d8bcfb72bc1880d0cf19822eb0a2e6577ab62";
const vbUSDC = "0x203a662b0bd271a6ed5a60edfbd04bfce608fd36";
const vbUSDT = "0x2dca96907fde857dd3d816880a0df407eeb2d2f2";
const vbUSDS = "0x62d6a123e8d19d06d68cf0d2294f9a3a0362c6b3";
const vbWBTC = "0x0913da6da4b42f538b445599b46bb4622342cf52";
const KAT = "0x7f1f4b4b29f5058fa32cc7a97141b8d7e5abdc2d";
const AUSD = "0x00000000efe302beaa2b3e6e1b18d08d69a9012a";
const bvUSD = "0x876aac7648d79f87245e73316eb2d100e75f3df1";
const sbvUSD = "0x24e2ae2f4c59b8b7a03772142d439fdf13aaf15b";
const weETH = "0x9893989433e7a383cb313953e4c2365107dc19a7";
const jitoSOL = "0x6c16e26013f2431e8b2e1ba7067ecccad0db6c52";
const uSOL = "0x9b8df6e244526ab5f6e6400d331db28c8fdddb55";
const MORPHO = "0x1e5efca3d0db2c6d5c67a4491845c43253eb9e4e";
const POL = "0xb24e3035d1fcbc0e43cf3143c3fd92e53df2009b";
const SUSHI = "0x17bff452dae47e07cea877ff0e1aba17eb62b0ab";
const YFI = "0x476eacd417cd65421bd34fca054377658bb5e02b";
const LBTC = "0xecac9c5f704e954931349da37f60e39f515c11c1";
const BTCK = "0xb0f70c0bd6fd87dbeb7c10dc692a2a6106817072";
const wstETH = "0x7fb4d0f51544f24f385a421db6e7d4fc71ad8e5c";
const unKAT = "0xa6c996a8d401271e8c4f95927443538d4a1f3fa2";
const SFRXUSD = "0x5bff88ca1442c2496f7e475e9e7786383bc070c0";
const FRXUSD = "0x80eede496655fb9047dd39d9f418d5483ed600df";

export const KATANA_CONFIG: ChainConfig = {
  factoryAddress: "0x203e8740894c8955cb8950759876d7e7e45e04c1",
  positionManagerAddress: "0x2659c6085d26144117d904c46b48b6d180393d27",
  wrappedNativeAddress: NATIVE_ADDRESS,
  stablecoinWrappedNativePoolId: "0x105f833d8522f33d8dc3e9599455e9412b63d049",
  stablecoinIsToken0: false,
  minimumNativeLocked: new BigDecimal("0.5"),
  stablecoinAddresses: [vbUSDC, vbUSDT, vbUSDS, AUSD, bvUSD, FRXUSD],
  whitelistTokens: [
    NATIVE_ADDRESS,
    vbUSDC,
    vbUSDT,
    vbUSDS,
    vbWBTC,
    KAT,
    AUSD,
    bvUSD,
    sbvUSD,
    weETH,
    jitoSOL,
    uSOL,
    MORPHO,
    POL,
    SUSHI,
    YFI,
    LBTC,
    BTCK,
    wstETH,
    unKAT,
    SFRXUSD,
    FRXUSD,
  ],
  tokenOverrides: [],
  poolsToSkip: [],
  nativeTokenDetails: {
    symbol: "ETH",
    name: "Ethereum",
    decimals: 18n,
  },
};

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  [KATANA_CHAIN_ID]: KATANA_CONFIG,
};

export function getChainConfig(chainId: number): ChainConfig {
  const cfg = CHAIN_CONFIGS[chainId];
  if (!cfg) throw new Error(`No chain config for chainId ${chainId}`);
  return cfg;
}
