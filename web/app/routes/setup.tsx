import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { AddProjectForm } from "../components/setup/add-project-form";
import { Notice } from "../components/ui";
import { chain, useRound, useSwarm } from "../context/providers";
import { usePool } from "../hooks/use-pool";
import { errorMessage, privacyAbi, proposalAbi } from "../lib/proposals";
import { publicKey, sharingKey } from "../lib/private-proposals";
import { prepareProposalPublication } from "../lib/proposal-publication";
import { PrivateReviewSettings } from "../components/setup/private-review-settings";
import { assertWallet } from "../lib/transactions";
import { ProposalBoard } from "./proposals";

export default function SetupPage() {
  const { pool, markMined } = useRound();
  const { address } = useAccount();
  const { client: storage, info } = useSwarm();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient({ chainId: chain.id });
  const round = usePool();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<string>();
  const [prepared, setPrepared] = useState<
    Awaited<ReturnType<typeof prepareProposalPublication>> & {
      pool: string;
      account: string;
      identity: string;
    }
  >();
  const owner = !!address && !!round.data &&
    address.toLowerCase() === round.data.owner.toLowerCase();
  const registered = !!round.data?.organizerPublicKey && round.data.organizerPublicKey !== "0x";
  let matches = false;
  try {
    matches = registered && !!storage &&
      sharingKey(storage) === publicKey(round.data!.organizerPublicKey);
  } catch { /* connect Swarm ID */ }
  const ready = prepared?.pool === pool && prepared?.account === address &&
      prepared?.identity === info?.identity?.id
    ? prepared
    : undefined;

  async function privateAction(action: "register" | "prepare" | "publish") {
    if (!wallet || !publicClient || !address || !pool || !round.data?.privacy || !storage) return;
    setBusy(true);
    setError(undefined);
    setAdded(undefined);
    try {
      await assertWallet(publicClient, wallet, address);
      if (action === "prepare") {
        const result = await prepareProposalPublication(publicClient, storage, pool, setAdded);
        setPrepared({ ...result, pool, account: address, identity: info?.identity?.id ?? "" });
        setAdded("The accepted revisions are ready. Publish them to open voting.");
        return;
      }
      let hash;
      if (action === "register") {
        const { request } = await publicClient.simulateContract({
          address: round.data.privacy,
          abi: privacyAbi,
          functionName: "setOrganizerKey",
          args: [`0x${sharingKey(storage)}`],
          account: address,
        });
        hash = await wallet.writeContract({ ...request, chain: wallet.chain });
      } else {
        if (!ready || !matches) {
          throw new Error("Prepare voting again with the organizer’s wallet and Swarm ID.");
        }
        const currentIds = await publicClient.readContract({
          address: round.data.privacy,
          abi: privacyAbi,
          functionName: "acceptedProposals",
        });
        if (
          currentIds.length !== ready.ids.length || currentIds.some((id, i) => id !== ready.ids[i])
        ) {
          setPrepared(undefined);
          throw new Error(
            "The accepted proposal list changed. Prepare voting again before publishing.",
          );
        }
        // This user action explicitly publishes the keys. Preparation never sends
        // them to the RPC; once sent, a reverted transaction cannot undo disclosure.
        hash = await wallet.writeContract({
          address: round.data.privacy,
          abi: privacyAbi,
          functionName: "openVoting",
          args: [ready.ids, ready.keys],
          account: address,
          chain: wallet.chain,
        });
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The transaction reverted. Refresh the round and retry.");
      }
      setPrepared(undefined);
      markMined(Number(receipt.blockNumber));
      await queryClient.invalidateQueries({ queryKey: ["pool"] });
      await queryClient.invalidateQueries({ queryKey: ["voting"] });
      setAdded(
        action === "register"
          ? "Private review enabled. Proposers can now submit encrypted proposals."
          : "Voting is open. The accepted final revisions are now public.",
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function addProject(cost: bigint, recipient: `0x${string}`) {
    if (!wallet || !publicClient || !pool) return;
    setBusy(true);
    setError(undefined);
    setAdded(undefined);
    try {
      await assertWallet(publicClient, wallet, wallet.account!.address);
      const hash = await wallet.writeContract({
        address: pool,
        abi: proposalAbi,
        functionName: "addProject",
        args: [cost, recipient],
        account: wallet.account!,
        chain: wallet.chain,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      markMined(Number(receipt.blockNumber));
      await queryClient.invalidateQueries({ queryKey: ["pool"] });
      setAdded("Project added.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {round.data && owner && (
        <div className="mb-8 stack">
          <PrivateReviewSettings
            supported={!!round.data.privacy}
            registered={registered}
            locked={round.data.count > 0n}
            matches={matches}
            busy={busy}
            votingOpen={round.data.votingOpen}
            preparedCount={ready?.ids.length}
            onRegister={() => privateAction("register")}
            onPrepare={() => privateAction("prepare")}
            onPublish={() => privateAction("publish")}
          />
          {error && <Notice error>{error}</Notice>}
          {added && <Notice>{added}</Notice>}
        </div>
      )}
      {round.data && owner && round.data.canSubmit && (
        <div className="mb-8">
          <AddProjectForm
            symbol={round.data.symbol}
            decimals={round.data.decimals}
            disabled={busy}
            busy={busy}
            onSubmit={addProject}
            error={error}
          />
        </div>
      )}
      <ProposalBoard review />
    </>
  );
}
