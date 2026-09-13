import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { AddProjectForm } from "../components/setup/add-project-form";
import { Notice } from "../components/ui";
import { useRound } from "../context/providers";
import { usePool } from "../hooks/use-pool";
import { errorMessage, proposalAbi } from "../lib/proposals";
import { assertWallet } from "../lib/transactions";
import { ProposalBoard } from "./proposals";

export default function SetupPage() {
  const { pool, markMined } = useRound();
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient();
  const round = usePool();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [added, setAdded] = useState<string>();
  const owner = !!address && !!round.data && address.toLowerCase() === round.data.owner.toLowerCase();

  async function addProject(cost: bigint, recipient: `0x${string}`) {
    if (!wallet || !publicClient || !pool) return;
    setBusy(true);
    setError(undefined);
    setAdded(undefined);
    try {
      await assertWallet(publicClient, wallet, wallet.account!.address);
      const hash = await wallet.writeContract({ address: pool, abi: proposalAbi, functionName: "addProject", args: [cost, recipient], account: wallet.account!, chain: wallet.chain });
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
      {round.data && owner && round.data.canSubmit && (
        <div className="mb-8">
          <AddProjectForm symbol={round.data.symbol} decimals={round.data.decimals} disabled={busy} busy={busy} onSubmit={addProject} error={error} />
          {added && <Notice>{added}</Notice>}
        </div>
      )}
      <ProposalBoard review />
    </>
  );
}
