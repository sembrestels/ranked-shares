import { readArkivVoters } from "../../../prover/src/core/arkiv";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useAccount,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { getWalletClient } from "wagmi/actions";
import { chain, config, useRound, useSwarm } from "../context/providers";
import { Button, Notice } from "../components/ui";
import { BallotForm, PublicResults } from "../components/voting";
import { errorMessage } from "../lib/proposals";
import {
  arkivChain,
  publishBallot,
  type PublishedBallot,
  readPending,
  resumePublication,
  savePending,
} from "../lib/arkiv";
import {
  ballotPayload,
  commitBallot,
  publicResults,
  readVoting,
} from "../lib/ballots";
import { assertWallet } from "../lib/transactions";
import { readContent } from "../lib/swarm";
import { ballotAbi } from "../../../cre/src/lib/arkiv";

export default function VotePage() {
  const { pool } = useRound();
  const { client: swarm } = useSwarm();
  const { address } = useAccount();
  const client = usePublicClient({ chainId: chain.id });
  const { data: wallet } = useWalletClient();
  const { switchChainAsync } = useSwitchChain();
  const cache = useQueryClient();
  const [ranks, setRanks] = useState<string[]>([]);
  const [sealed, setSealed] = useState(false);
  const [pending, setPending] = useState<PublishedBallot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  useEffect(() => {
    try {
      setPending(readPending());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    setRanks([]);
    setSealed(false);
  }, [pool, address]);
  const round = useQuery({
    queryKey: ["voting", chain.id, pool, address],
    enabled: !!pool && !!client,
    refetchInterval: 15_000,
    queryFn: () => readVoting(client!, pool!, address),
  });
  const r = round.data;
  const canVote = !!r?.enabled && r.phase === 1 && r.timestamp < r.deadline;
  const canPublic = canVote && !!address && r.direct > 0n &&
    r.direct >= r.minimum &&
    (r.kind === "public" || r.publicRef?.revision === 0n);
  const canSealed = canVote && !!address && r.kind !== "public" &&
    r.seats > 0n && r.seats >= r.minimumSealed;
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
      r?.projects.map((p) => p.contentRef).join(","),
    ],
    enabled: !!swarm && !!r,
    staleTime: Infinity,
    queryFn: () =>
      Promise.all(r!.projects.map(async (p) => {
        try {
          return (await readContent(swarm!, p.contentRef)).title;
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
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      try {
        setPending(readPending());
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
  async function storeVote() {
    if (!r || !client || !pool || !address || !wallet) {
      throw new Error("Connect your wallet and choose a round first.");
    }
    if (readPending()) {
      throw new Error(
        "Finish or discard your pending ballot before preparing another one.",
      );
    }
    const fresh = await readVoting(client, pool, address);
    if (
      !fresh.enabled || fresh.phase !== 1 || fresh.timestamp >= fresh.deadline
    ) throw new Error("This round is not open for Arkiv voting.");
    const selected = fresh.projects.map((p) => Number(ranks[p.id] ?? "0"));
    const payload = await ballotPayload(
      client,
      pool,
      address,
      fresh.kind,
      sealed,
      selected,
    );
    const ballot: PublishedBallot = {
      pool,
      chainId: chain.id,
      account: address,
      kind: fresh.kind,
      isSealed: sealed,
      revision: ((sealed ? fresh.sealedRef : fresh.publicRef)!.revision + 1n)
        .toString(),
      payload,
      projects: selected.length,
    };
    await switchChainAsync({ chainId: arkivChain.id });
    const storageWallet = await getWalletClient(config, {
      chainId: arkivChain.id,
    });
    await publishBallot(storageWallet, ballot, fresh.deadline, fresh.grace);
    setRanks([]);
    setMessage(
      "Your ballot is stored. Confirm it in the round to make it count.",
    );
  }
  async function confirmVote() {
    if (
      !pending || pending.pool.toLowerCase() !== pool?.toLowerCase() ||
      pending.account.toLowerCase() !== address?.toLowerCase() ||
      pending.chainId !== chain.id
    ) {
      throw new Error(
        "Select the saved ballot's pool and reconnect its wallet before continuing.",
      );
    }
    if (!pending.voteTx) await resumePublication(pending);
    const w = await onPoolNetwork();
    await commitBallot(client!, w, pending);
    setMessage("Your ballot has been accepted by the round.");
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
          Rank the accepted projects. Follow the public result as the round
          progresses.
        </p>
        <a href={`/?pool=${pool}`}>Read the proposals ↗</a>
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
          Voting deadline:{" "}
          {new Date(Number(r.deadline) * 1000).toLocaleString()}
        </p>
      )}
      {pending && (
        <section className="voting-pending">
          <h2>Finish your ballot</h2>
          <p>
            Pool <code>{pending.pool}</code> · voter{" "}
            <code>{pending.account}</code>
          </p>
          <p>
            {pending.entityKey
              ? "Stored in Arkiv. The vote counts only after the pool accepts it."
              : pending.storageTx
              ? "Storage transaction pending. Resume to check its receipt."
              : "No storage transaction hash was received. Check your wallet activity before discarding this draft and preparing another ballot."}
          </p>
          {pending.storageTx && (
            <p>
              Arkiv transaction: <code>{pending.storageTx}</code>
            </p>
          )}
          {pending.entityKey && (
            <p>
              Entity: <code>{pending.entityKey}</code> · expiry block{" "}
              {pending.expiresAt}
            </p>
          )}
          {pending.voteTx && (
            <p>
              Pool transaction: <code>{pending.voteTx}</code>
            </p>
          )}
          <div className="actions">
            <Button disabled={busy} onClick={() => run(confirmVote)}>
              2. Confirm ballot in the round
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !!pending.voteTx}
              onClick={() => {
                savePending();
                setPending(undefined);
              }}
            >
              Discard local draft
            </Button>
          </div>
          <p className="hint">
            Discarding the draft does not remove an Arkiv upload or cancel a
            sent transaction.
          </p>
        </section>
      )}
      {canVote && !pending && (
        <>
          <p>
            {!address
              ? "Connect your wallet to vote."
              : !canPublic && !canSealed
              ? "This wallet has no eligible voting weight, or its public ballot is already final."
              : r?.kind === "public"
              ? "Your public ballot can be replaced until the deadline."
              : "Public ballots are final once accepted. Encrypted seat ballots can be replaced until the deadline."}
          </p>
          <BallotForm
            titles={titles}
            ranks={ranks}
            sealed={sealed}
            canPublic={canPublic}
            canSealed={canSealed}
            busy={busy}
            onRank={(id, value) =>
              setRanks((previous) => {
                const next = [...previous];
                next[id] = value;
                return next;
              })}
            onMode={setSealed}
            onSubmit={() => run(storeVote)}
          />
        </>
      )}
      {results.error && (
        <Notice error>
          Results are unavailable: {errorMessage(results.error)}{" "}
          No partial tally is shown.
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
    </div>
  );
}
