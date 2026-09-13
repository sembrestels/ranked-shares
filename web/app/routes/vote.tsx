import { readArkivVoters } from "../../../prover/src/core/arkiv";
import { useEffect, useState } from "react";
import { formatUnits } from "viem";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { chain, config, useRound } from "../context/providers";
import { Button, Field, Input, Notice } from "../components/ui";
import { BallotForm, BallotReview, PublicResults } from "../components/voting";
import { useBallotReview } from "../hooks/use-ballot-review";
import { contributionAmount, readContribution } from "../lib/contribution";
import { castVote, prepareVote, readPendingCast, savePendingCast, type PendingCast } from "../lib/cast-vote";
import { BALLOT_RETENTION_SECONDS, ballotRetentionUntil } from "../lib/ballot-retention";
import { errorMessage } from "../lib/proposals";
import { loadPayloads } from "../lib/arkiv";
import { publicResults, readVoting, votingBlockReason } from "../lib/ballots";
import { tierRanks, type TierAssignments } from "../lib/ballot-tiers";
import { assertWallet } from "../lib/transactions";
import { readProposalContent } from "../lib/private-proposals";
import { publicSwarmStorage } from "../lib/public-swarm";
import { ballotAbi } from "../../../cre/src/lib/arkiv";

const publicStorage = publicSwarmStorage();

export default function VotePage() {
  const { pool } = useRound();
  const { address } = useAccount();
  const client = usePublicClient({ chainId: chain.id });
  const { switchChainAsync } = useSwitchChain();
  const cache = useQueryClient();
  const [assignments, setAssignments] = useState<TierAssignments>({});
  const [sealed, setSealed] = useState(false);
  const [pending, setPending] = useState<PendingCast>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [reviewLimit, setReviewLimit] = useState(50);
  const [amountText, setAmountText] = useState<string>();
  const [accepted, setAccepted] = useState<PendingCast>();
  useEffect(() => {
    try {
      setPending(readPendingCast());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    setAssignments({});
    setSealed(false);
    setReviewLimit(50);
    setAmountText(undefined);
    setAccepted(undefined);
  }, [pool, address]);
  const round = useQuery({
    queryKey: ["voting", chain.id, pool, address],
    enabled: !!pool && !!client,
    refetchInterval: 15_000,
    queryFn: () => readVoting(client!, pool!, address),
  });
  const r = round.data;
  const funds = useQuery({
    queryKey: ["vote-funds", chain.id, pool, address], enabled: !!client && !!pool && !!address && !!r,
    queryFn: () => readContribution(client!, pool!, address!), refetchInterval: 15_000,
  });
  const needed = r ? r.minimum > r.direct ? r.minimum - r.direct : r.direct > 0n ? 0n : 1n : 0n;
  const amountValue = amountText ?? (funds.data ? formatUnits(needed, funds.data.decimals) : "");
  let amount = 0n;
  let amountIssue = funds.error ? errorMessage(funds.error) : undefined;
  if (funds.data) {
    try {
      amount = /^0(?:\.0+)?$/.test(amountValue) ? 0n : contributionAmount(amountValue, funds.data.decimals);
      if (amount < needed) amountIssue = `Contribute at least ${formatUnits(needed, funds.data.decimals)} ${funds.data.symbol} to vote publicly.`;
      else if (amount > funds.data.balance) amountIssue = `Your wallet needs ${formatUnits(amount - funds.data.balance, funds.data.decimals)} more ${funds.data.symbol}.`;
    } catch (e) { amountIssue = errorMessage(e); }
  }
  const storage = useQuery({
    queryKey: ["accepted-vote-storage", accepted?.id], enabled: !!accepted,
    queryFn: async () => (await loadPayloads([accepted!.id])).get(accepted!.id) === accepted!.payload,
    refetchInterval: (q) => q.state.data ? false : 15_000,
  });
  const showReview = !!r?.enabled && r.phase > 0 && r.timestamp >= r.deadline;
  const review = useBallotReview(client, chain.id, pool, showReview);
  const canVote = !!r?.enabled && r.phase === 1 && r.timestamp < r.deadline;
  const publicReason = !address ? "Connect your wallet to vote." : amountIssue ?? (!funds.data ? "Loading your token balance…" : r ? votingBlockReason({ ...r, direct: r.direct + amount }, address, false) : undefined);
  const sealedReason = r ? votingBlockReason(r, address, true) : undefined;
  const canPublic = !!r && !publicReason;
  const canSealed = !!r && !sealedReason;
  useEffect(() => {
    if (!canPublic && canSealed) setSealed(true);
    else if (canPublic && !canSealed) setSealed(false);
  }, [canPublic, canSealed]);
  const results = useQuery({
    queryKey: ["public-results", chain.id, pool, r?.block.toString()],
    enabled: !!r?.enabled && r.phase > 0,
    queryFn: () => publicResults(client!, pool!, r!),
  });
  const names = useQuery({
    queryKey: [
      "voting-project-names",
      pool,
      r?.projects.map((p) => `${p.contentRef}:${p.publishedKey}`).join(","),
    ],
    enabled: !!r,
    staleTime: Infinity,
    queryFn: () =>
      Promise.all(r!.projects.map(async (p) => {
        if (/^0x0{64}$/.test(p.contentRef)) return `Project ${p.id + 1}`;
        try {
          return (await readProposalContent(publicStorage, p.contentRef, {
            publishedKey: p.publishedKey,
            publicOnly: true,
          })).title;
        } catch {
          return `Project ${p.id + 1}`;
        }
      })),
  });
  const titles = names.data ?? r?.projects.map((p) => `Project ${p.id + 1}`) ??
    [];
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      await action();
      await cache.invalidateQueries({ queryKey: ["voting"] });
      await cache.invalidateQueries({ queryKey: ["vote-funds"] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      try {
        setPending(readPendingCast());
      } catch (e) {
        setError(errorMessage(e));
      }
    }
  }
  async function onPoolNetwork() {
    if (!address) throw new Error("Connect your wallet first.");
    await switchChainAsync({ chainId: chain.id });
    // Get a fresh wallet after switching, rather than using React's previous render.
    const w = await getWalletClient(config, { chainId: chain.id });
    await assertWallet(client!, w, address);
    return w;
  }
  async function submitVote() {
    if (!client || !pool || !address) throw new Error("Connect your wallet first.");
    const saved = readPendingCast();
    if (!saved && !r) throw new Error("Wait for the round to finish loading.");
    const draft = saved ?? await prepareVote(client, pool, address, sealed ? 0n : amount, sealed, tierRanks(r!.projects.map((p) => p.id), assignments));
    if (draft.pool.toLowerCase() !== pool.toLowerCase() || draft.account.toLowerCase() !== address.toLowerCase() || draft.chainId !== chain.id) {
      throw new Error("Reconnect the wallet and pool belonging to your pending vote.");
    }
    const wallet = await onPoolNetwork();
    const result = await castVote(client, wallet, draft, setMessage);
    setAccepted(result);
    setAssignments({});
    setAmountText(undefined);
    setMessage("Your vote is recorded. Arkiv storage syncs automatically; no further transaction is needed.");
  }
  async function poolAction(action: "enable" | "tally") {
    if (!r || !client || !pool || !address) return;
    const w = await onPoolNetwork();
    const send = async (
      functionName:
        | "enableArkivBallots"
        | "startTally"
        | "runArkiv"
        | "closeArkiv",
      args: readonly unknown[] = [],
    ) => {
      await assertWallet(client, w, address);
      const { request } = await client.simulateContract(
        {
          address: pool,
          abi: ballotAbi,
          functionName,
          args,
          account: address,
        } as never,
      );
      const hash = await w.writeContract({ ...request, chain: w.chain });
      const receipt = await client.waitForTransactionReceipt({
        hash,
        timeout: 60_000,
      });
      if (receipt.status !== "success") {
        throw new Error("The round transaction reverted. Refresh and retry.");
      }
    };
    if (action === "enable") await send("enableArkivBallots");
    else if (r.kind === "public" && r.phase === 1) await send("startTally");
    else {
      const voters = await readArkivVoters(client, pool);
      if (r.kind === "public") {
        await send("runArkiv", [
          20n,
          voters.map((v) => v.publicBallot),
        ]);
      } else {
        const cursor = await client.readContract({
          address: pool,
          abi: ballotAbi,
          functionName: "closeCursor",
        });
        await send("closeArkiv", [
          cursor,
          voters.slice(Number(cursor), Number(cursor) + 20).map((
            { publicBallot, sealedBallot },
          ) => ({ publicBallot, sealedBallot })),
        ]);
      }
    }
    setMessage(
      action === "enable"
        ? "Arkiv ballot storage is enabled for this round."
        : "The tally advanced. Refresh the round to see its current phase.",
    );
  }
  if (!pool) {
    return <Notice>Choose a pool above to vote and view results.</Notice>;
  }
  return (
    <div className="voting-page">
      <header className="page-heading">
        <p className="eyebrow">COMMUNITY DECISIONS</p>
        <h1>Vote & results</h1>
        <p>
          Group proposals by funding priority. Follow the public result as the round
          progresses.
        </p>
        <a href={`/proposals?pool=${pool}`}>Read the proposals ↗</a>
      </header>
      {(error || round.error) && (
        <Notice error>
          {error ?? errorMessage(round.error)}
          {round.error
            ? " This page requires a pool deployed with Arkiv support."
            : ""}
        </Notice>
      )}
      {message && <Notice>{message}</Notice>}
      {round.isPending && <Notice>Loading the round…</Notice>}
      {r && !r.enabled && (
        <Notice>
          Arkiv ballot storage must be enabled by the organizer before voting
          opens. Existing deployed pools require a new deployment to use this
          flow.
        </Notice>
      )}
      {r?.phase === 0 && address?.toLowerCase() === r.owner.toLowerCase() &&
        !r.enabled && (
        <Button
          disabled={busy}
          onClick={() => run(() => poolAction("enable"))}
        >
          Enable Arkiv ballot storage
        </Button>
      )}
      {r && (
        <p>
          Voting deadline: {new Date(Number(r.deadline) * 1000).toLocaleString()}
        </p>
      )}
      {r?.enabled && r.grace > BALLOT_RETENTION_SECONDS && (
        <Notice>
          This round's recovery window is longer than the default ballot retention.
          Complete the tally before Arkiv expiry; a delayed tally may need original
          transaction data or a separately preserved copy.
        </Notice>
      )}
      {accepted && <Notice>
        {storage.data ? "Ballot synced to Arkiv." : "Your vote counts on-chain. Waiting for the storage worker to sync it to Arkiv."}
        {" "}Transaction: <code>{accepted.voteTx}</code>
      </Notice>}
      {pending && <section className="voting-pending">
        <h2>{pending.voteTx ? "Vote awaiting confirmation" : "Resume your vote"}</h2>
        <p>Pool <code>{pending.pool}</code> · voter <code>{pending.account}</code></p>
        <p>{pending.voteTx ? "Check the transaction already sent. This will not send another contribution or vote." : "Your ranking is saved. Resume authorization and cast your vote."}</p>
        {(pending.voteTx || pending.approvalTx) && <p>Transaction: <code>{pending.voteTx ?? pending.approvalTx}</code></p>}
        <Button disabled={busy} onClick={() => run(submitVote)}>{pending.voteTx ? "Check vote confirmation" : "Resume vote"}</Button>
        {!pending.voteTx && !pending.approvalTx && <Button variant="secondary" disabled={busy} onClick={() => { savePendingCast(); setPending(undefined); }}>Edit ranking</Button>}
      </section>}
      {canVote && !pending && (
        <>
          <p>
            {!address
              ? "Connect your wallet to vote."
              : r?.kind === "public"
              ? "Your public ballot can be replaced until the deadline."
              : "Public ballots are final once accepted. Encrypted seat ballots can be replaced until the deadline."}
          </p>
          <BallotForm
            key={`${pool}:${address ?? ""}`}
            titles={titles}
            assignments={assignments}
            sealed={sealed}
            canPublic={canPublic}
            canSealed={canSealed}
            busy={busy}
            disabledReason={sealed ? sealedReason : publicReason}
            submitLabel={busy ? "Submitting vote…" : sealed || amount === 0n ? "Vote" : "Contribute and vote"}
            contribution={!sealed && address ? funds.data ? <Field id="vote-contribution" label={`Contribution (${funds.data.symbol})`} hint={`Wallet balance: ${formatUnits(funds.data.balance, funds.data.decimals)} ${funds.data.symbol}. Your contribution and ballot are recorded together; a rejected ballot also rolls back the contribution.`}>
              <Input id="vote-contribution" inputMode="decimal" value={amountValue} disabled={busy} aria-invalid={!!amountIssue} aria-describedby="vote-contribution-hint" onChange={(e) => setAmountText(e.target.value)} />
              {amountIssue && <Notice>{amountIssue}</Notice>}
            </Field> : <Notice>{amountIssue ?? "Loading contribution requirements…"}</Notice> : undefined}
            onAssign={(id, tier) =>
              setAssignments((previous) => {
                const next = { ...previous };
                if (tier === undefined) delete next[id];
                else next[id] = tier;
                return next;
              })}
            onMode={setSealed}
            onSubmit={() => run(submitVote)}
          />
        </>
      )}
      {results.error && (
        <Notice error>
          Results are unavailable: {errorMessage(results.error)} No partial tally is shown.
        </Notice>
      )}
      {results.isFetching && !results.data && r?.enabled && r.phase > 0 && (
        <Notice>
          Reading accepted ballots and calculating the public result…
        </Notice>
      )}
      {results.data && r && !results.error && (
        <>
          <PublicResults
            titles={titles}
            {...results.data}
            block={r.block}
            sealedPool={r.kind !== "public"}
          />
          {results.data.recovered > 0 && (
            <Notice>
              {results.data.recovered}{" "}
              {results.data.recovered === 1 ? "ballot was" : "ballots were"}
              {" "}
              recovered from original pool transactions because Arkiv could not
              serve the data.
            </Notice>
          )}
        </>
      )}
      {r?.enabled && r.timestamp >= r.deadline &&
        (r.kind === "public"
          ? r.phase === 1 || r.phase === 2
          : r.phase === 2) &&
        (
          <Button
            disabled={busy || !address}
            onClick={() => run(() => poolAction("tally"))}
          >
            {r.kind === "public"
              ? "Advance pool tally"
              : "Prepare next batch for final tally"}
          </Button>
        )}
      {showReview && r && (
        <BallotReview
          data={review.data}
          error={review.error ? errorMessage(review.error) : undefined}
          loading={review.isFetching}
          until={ballotRetentionUntil(r.deadline)}
          final={r.phase === (r.kind === "public" ? 3 : 4)}
          limit={reviewLimit}
          onMore={() => setReviewLimit((n) => n + 50)}
        />
      )}
    </div>
  );
}
