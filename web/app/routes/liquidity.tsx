import { type FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { type Address, erc20Abi, type Hex, isAddress } from "viem";
import { chain, useRound } from "../context/providers";
import { Button, Notice } from "../components/ui";
import {
  CampaignCard,
  LiquidityHeader,
  PositionCard,
  PositionLookup,
  SponsorForm,
} from "../components/liquidity";
import { lpPoolAbi, readLP, sendLPAction, sponsorshipArgs } from "../lib/lp";
import { assertWallet } from "../lib/transactions";
import { errorMessage } from "../lib/proposals";

export const meta = () => [{ title: "Liquidity · RankedShares" }];

export default function LiquidityPage() {
  const { pool } = useRound();
  const { address } = useAccount();
  const client = usePublicClient({ chainId: chain.id });
  const { data: wallet } = useWalletClient();
  const cache = useQueryClient();
  const [manualId, setManualId] = useState<bigint>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<Hex>();
  const pendingKey = `ranked-shares:lp:${chain.id}:${pool}:${address}`;
  useEffect(() => {
    setPending(
      (localStorage.getItem(pendingKey) || undefined) as Hex | undefined,
    );
    setManualId(undefined);
  }, [pendingKey]);
  const query = useQuery({
    queryKey: ["liquidity", chain.id, pool, address, manualId?.toString()],
    enabled: !!client && !!pool,
    refetchInterval: 15_000,
    queryFn: () =>
      readLP(
        client!,
        pool!,
        address,
        BigInt(import.meta.env.VITE_LP_FROM_BLOCK || "0"),
        manualId,
      ),
  });
  const data = query.data;
  async function receipt(hash: Hex) {
    setMessage(undefined);
    localStorage.setItem(pendingKey, hash);
    setPending(hash);
    const result = await client!.waitForTransactionReceipt({ hash });
    localStorage.removeItem(pendingKey);
    setPending(undefined);
    if (result.status !== "success") {
      throw new Error(
        "The transaction reverted. Your voting weight did not change.",
      );
    }
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ["liquidity"] });
      await cache.invalidateQueries({ queryKey: ["voting"] });
    } catch (e) {
      setMessage(undefined);
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function act(
    action: Parameters<typeof sendLPAction>[4],
    target: Address,
  ) {
    if (!client || !wallet || !address || pending) {
      throw new Error(
        "Connect your wallet and finish any pending transaction first.",
      );
    }
    setMessage("Review and confirm the transaction in your wallet.");
    const hash = await sendLPAction(client, wallet, address, target, action);
    await receipt(hash);
    setMessage(
      action.type === "claim"
        ? "Position registered. You can now vote privately while your weight accrues."
        : action.type === "stop"
        ? "Accrual stopped. Your previously earned share is retained."
        : "Finalization advanced. CRE can continue the remaining steps.",
    );
  }
  async function sponsor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      if (!data || !pool || !client || !wallet || !address || pending) {
        throw new Error(
          "Connect your wallet and finish any pending transaction first.",
        );
      }
      const stable = String(form.get("stable")).trim();
      if (!isAddress(stable)) {
        throw new Error("Enter a valid valuation token address.");
      }
      const args = await sponsorshipArgs(
        client,
        data,
        BigInt(String(form.get("positionId"))),
        stable,
        String(form.get("amount")),
        String(form.get("minimum")),
      );
      await assertWallet(client, wallet, address);
      const allowance = await client.readContract({
        address: data.token,
        abi: erc20Abi,
        functionName: "allowance",
        args: [address, pool],
      });
      if (allowance < args[0]) {
        const { request } = await client.simulateContract({
          address: data.token,
          abi: erc20Abi,
          functionName: "approve",
          args: [pool, args[0]],
          account: address,
        });
        setMessage(
          "Approve the voting budget in your wallet. Sponsorship follows after approval confirms.",
        );
        await receipt(
          await wallet.writeContract({ ...request, chain: wallet.chain }),
        );
      }
      await assertWallet(client, wallet, address);
      const { request } = await client.simulateContract({
        address: pool,
        abi: lpPoolAbi,
        functionName: "sponsorLP",
        args,
        account: address,
      });
      setMessage("Confirm the sponsorship in your wallet.");
      await receipt(
        await wallet.writeContract({ ...request, chain: wallet.chain }),
      );
      setMessage("Sponsorship funded. LPs can now register their positions.");
    });
  }
  if (!pool) return <Notice>Choose a round to see its LP sponsorships.</Notice>;
  return (
    <div className="liquidity-page">
      <LiquidityHeader pool={pool} account={address} />
      {data && (
        <p>
          Voting and accrual {data.timestamp < data.deadline ? "end" : "ended"}
          {" "}
          <time dateTime={new Date(Number(data.deadline) * 1000).toISOString()}>
            {new Date(Number(data.deadline) * 1000).toLocaleString()}
          </time>.
        </p>
      )}
      {query.isPending && <Notice>Loading liquidity sponsorships…</Notice>}
      {query.error && (
        <Notice error>
          Could not load LP sponsorships: {errorMessage(query.error)}{" "}
          <Button variant="secondary" onClick={() => query.refetch()}>
            Retry
          </Button>
        </Notice>
      )}
      {error && <Notice error>{error}</Notice>}
      {message && <Notice>{message}</Notice>}
      {pending && (
        <Notice>
          Transaction awaiting confirmation: <code>{pending}</code>{" "}
          <Button disabled={busy} onClick={() => run(() => receipt(pending))}>
            Check confirmation
          </Button>
        </Notice>
      )}
      {data && (
        <>
          <section className="lp-campaigns" aria-label="Sponsored budgets">
            {data.campaigns.map((c) => (
              <CampaignCard
                key={c.id.toString()}
                campaign={c}
                data={data}
                busy={busy || !!pending || !address}
                onFinalize={() =>
                  run(() => act({ type: "finalize", id: c.id }, data.module))}
              />
            ))}
            {data.campaigns.length === 0 && (
              <Notice>No LP budgets have been sponsored yet.</Notice>
            )}
          </section>
          <section className="lp-positions" aria-labelledby="your-positions">
            <h2 id="your-positions">Your positions</h2>
            {data.discoveryNote && <Notice>{data.discoveryNote}</Notice>}
            {address && data.positions.length === 0 && (
              <Notice>
                No owned positions found. Enter an NFT ID or check the connected
                wallet.
              </Notice>
            )}
            {data.positions.map((p) => (
              <PositionCard
                key={p.id.toString()}
                position={p}
                busy={busy || !!pending}
                onClaim={() =>
                  run(() =>
                    act({
                      type: "claim",
                      tokenId: p.id,
                      module: data.module,
                      id: p.campaignId!,
                    }, data.manager)
                  )}
                onStop={() =>
                  run(() => act({ type: "stop", tokenId: p.id }, data.manager))}
              />
            ))}
            <PositionLookup
              busy={busy || !address}
              onSubmit={(event) => {
                event.preventDefault();
                setManualId(
                  BigInt(
                    String(new FormData(event.currentTarget).get("positionId")),
                  ),
                );
              }}
            />
          </section>
          {data.phase === 1 && address && (
            <SponsorForm
              data={data}
              busy={busy || !!pending}
              onSubmit={sponsor}
            />
          )}
          <p className="hint">
            Registering does not transfer your position. Withdrawal or transfer
            stops future accrual; the previous owner keeps their earned share.
            Final weights are calculated after voting closes.
          </p>
        </>
      )}
    </div>
  );
}
