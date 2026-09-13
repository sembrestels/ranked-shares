/** Shared defaults keep browser, prerender and API on the same network. */
export function networkDefaults(id = 5042002) {
  const arc = id === 5042002;
  return {
    id,
    name: arc ? "Arc Testnet" : id === 31337 ? "Anvil" : `Chain ${id}`,
    nativeCurrency: { name: arc ? "USDC" : "ETH", symbol: arc ? "USDC" : "ETH", decimals: 18 },
    rpcUrls: { default: { http: [arc ? "https://rpc.testnet.arc.io" : "http://127.0.0.1:8545"] } },
    ...(arc ? { blockExplorers: { default: { name: "ArcScan", url: "https://testnet.arcscan.app" } }, testnet: true } : {}),
  };
}
