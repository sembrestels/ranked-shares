import { type Address, isAddress, zeroAddress } from "viem";

// Official Arc Testnet ERC-20 addresses:
// https://docs.arc.io/arc/references/contract-addresses
export const ARC_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_EURC = "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a";
export type FundingToken = { symbol: "USDC" | "EURC"; address?: Address };

/** Other networks need explicit token configuration, never Arc addresses as a fallback. */
export function fundingTokens(chainId: number): FundingToken[] {
  const configured = (value: string | undefined): Address | undefined =>
    value && isAddress(value) && value.toLowerCase() !== zeroAddress ? value : undefined;
  return [
    { symbol: "USDC", address: chainId === 5042002 ? ARC_USDC : configured(import.meta.env.VITE_USDC_ADDRESS) },
    { symbol: "EURC", address: chainId === 5042002 ? ARC_EURC : configured(import.meta.env.VITE_EURC_ADDRESS) },
  ];
}
