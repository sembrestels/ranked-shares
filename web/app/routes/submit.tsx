import { useEffect, useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import {
  type Address,
  decodeEventLog,
  formatUnits,
  type Hex,
  isAddress,
} from "viem";
import { chain, useRound, useSwarm } from "../context/providers";
import { usePool } from "../hooks/use-pool";
import { errorMessage, proposalAbi, proposalTerms } from "../lib/proposals";
import { publicReference, uploadProposal } from "../lib/swarm";
import { assertWallet, sendProposalTransaction } from "../lib/transactions";
import {
  type FormValues,
  SubmitForm,
} from "../components/proposals/submit-form";
import { Button, Fact, Notice } from "../components/ui";

type Prepared = {
  reference: Hex;
  cost: string;
  recipient: Address;
  title: string;
  hash?: Hex;
};

export default function SubmitPage() {
  const { pool } = useRound();
  const { address } = useAccount();
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">A place for your idea</p>
        <h1>
          Propose something<br />
          <em>worth funding.</em>
        </h1>
        <p>Write a pitch, share your files, and put your proposal forward.</p>
      </div>
      <Submission key={`${pool}-${address}`} />
    </>
  );
}

function Submission() {
  const { pool } = useRound();
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient({ chainId: chain.id });
  const { client, info } = useSwarm();
  const round = usePool();
  const queryClient = useQueryClient();
  const [value, setValue] = useState<FormValues>({
    title: "",
    body: "",
    files: [],
    amount: "",
    recipient: address || "",
  });
  const [prepared, setPrepared] = useState<Prepared>();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState<bigint>();
  const storageKey =
    `ranked-shares:proposal:${chain.id}:${pool?.toLowerCase()}:${address?.toLowerCase()}`;

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (!stored) return;
      const item = JSON.parse(stored);
      if (
        typeof item.cost !== "string" || !/^\d+$/.test(item.cost) ||
        !isAddress(item.recipient) || typeof item.title !== "string" ||
        (item.hash && !/^0x[0-9a-fA-F]{64}$/.test(item.hash))
      ) return;
      setPrepared({ ...item, reference: publicReference(item.reference) });
    } catch {
      /* Storage may be unavailable; in-memory recovery still works. */
    }
  }, [storageKey]);

  function keep(item?: Prepared) {
    setPrepared(item);
    try {
      if (item) localStorage.setItem(storageKey, JSON.stringify(item));
      else localStorage.removeItem(storageKey);
    } catch { /* optional recovery */ }
  }

  async function upload() {
    setError(undefined);
    setBusy(true);
    try {
      if (!round.data?.canSubmit || !pool) {
        throw new Error("This round is not accepting proposals.");
      }
      if (!address || !wallet || !publicClient) {
        throw new Error("Connect your wallet before uploading.");
      }
      if (!client) {
        throw new Error(
          "Swarm ID is still connecting. Try again when it is ready.",
        );
      }
      const terms = proposalTerms(
        value.amount,
        value.recipient,
        round.data.decimals,
      );
      await assertWallet(publicClient, wallet, address);
      const reference = await uploadProposal(client, value, setStatus);
      keep({
        reference,
        cost: terms.cost.toString(),
        recipient: terms.recipient,
        title: value.title,
      });
      setStatus(
        "Uploaded to Swarm. Review the details, then submit for organizer review.",
      );
    } catch (err) {
      setError(errorMessage(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (!prepared || !address || !pool || !publicClient || !wallet) return;
    setBusy(true);
    setError(undefined);
    try {
      let hash = prepared.hash;
      if (!hash) {
        setStatus("Confirm the proposal submission in your wallet…");
        hash = await sendProposalTransaction(
          publicClient,
          wallet,
          address,
          pool,
          {
            functionName: "propose",
            args: [
              prepared.reference,
              BigInt(prepared.cost),
              prepared.recipient,
            ],
          },
        );
        keep({ ...prepared, hash });
      }
      setStatus("Waiting for the proposal transaction to confirm…");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        onReplaced: ({ transaction }) =>
          keep({ ...prepared, hash: transaction.hash }),
      });
      if (receipt.status !== "success") {
        keep({ ...prepared, hash: undefined });
        throw new Error(
          "The transaction reverted. Your Swarm upload is saved; retry the submission.",
        );
      }
      let id: bigint | undefined;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== pool.toLowerCase()) continue;
        try {
          const event = decodeEventLog({ abi: proposalAbi, ...log });
          if (
            event.eventName === "Proposed" &&
            event.args.proposer.toLowerCase() === address.toLowerCase() &&
            event.args.contentRef === prepared.reference &&
            event.args.cost === BigInt(prepared.cost) &&
            event.args.recipient.toLowerCase() ===
              prepared.recipient.toLowerCase()
          ) id = event.args.proposalId;
        } catch { /* another contract event */ }
      }
      if (id === undefined) {
        keep({ ...prepared, hash: undefined });
        throw new Error(
          "The transaction was replaced or cancelled without submitting this proposal. You can retry.",
        );
      }
      setSubmitted(id);
      keep(undefined);
      setStatus(`Proposal #${id + 1n} is pending organizer review.`);
      await queryClient.invalidateQueries({ queryKey: ["pool"] });
    } catch (err) {
      setError(errorMessage(err));
      setStatus("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface submission">
      <div className="section-heading">
        <span className="eyebrow">
          {prepared ? "02 / Submit for review" : "01 / Your proposal"}
        </span>
        <span className="hint">Text + any files</span>
      </div>
      {!pool && <Notice>Choose a round above to start your proposal.</Notice>}
      {round.isError && (
        <Notice error>
          Could not load this round. Check its address and network, and that it
          supports proposals. {errorMessage(round.error)}
        </Notice>
      )}
      {round.data && !round.data.canSubmit && (
        <Notice>Submissions and review are closed for this round.</Notice>
      )}
      {!address && (
        <Notice>
          Connect your wallet above to submit. Swarm ID handles your uploads
          separately.
        </Notice>
      )}
      {submitted !== undefined
        ? (
          <div className="stack">
            <h2>Proposal received.</h2>
            <p>
              The organizer can now read and accept or reject your proposal.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                setSubmitted(undefined);
                setStatus("");
                setValue({
                  title: "",
                  body: "",
                  files: [],
                  amount: "",
                  recipient: address || "",
                });
              }}
            >
              Write another proposal
            </Button>
          </div>
        )
        : prepared
        ? (
          <div className="stack">
            <h2>{prepared.title}</h2>
            <dl className="facts">
              <Fact label="Requested">
                {round.data
                  ? `${
                    formatUnits(BigInt(prepared.cost), round.data.decimals)
                  } ${round.data.symbol}`
                  : `${prepared.cost} base units`}
              </Fact>
              <Fact label="Recipient">
                <code>{prepared.recipient}</code>
              </Fact>
              <Fact label="Saved on Swarm">
                <code>{prepared.reference.slice(2)}</code>
              </Fact>
              {prepared.hash && (
                <Fact label="Transaction">
                  <code>{prepared.hash}</code>
                </Fact>
              )}
            </dl>
            <p className="hint">
              Your upload is saved. Submitting binds these exact details to your
              wallet and this round.
            </p>
            <div className="actions">
              <Button
                disabled={busy || !wallet || chainId !== chain.id ||
                  (!prepared.hash && !round.data?.canSubmit)}
                onClick={submit}
              >
                {busy
                  ? "Submitting…"
                  : prepared.hash
                  ? "Check transaction"
                  : "Submit proposal"}
              </Button>
              {!prepared.hash && (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    keep(undefined);
                    setStatus("");
                  }}
                >
                  Edit proposal
                </Button>
              )}
            </div>
          </div>
        )
        : (
          <SubmitForm
            value={value}
            onChange={setValue}
            onUpload={upload}
            busy={busy}
            symbol={round.data?.symbol || "tokens"}
            disabled={!round.data?.canSubmit || !address ||
              chainId !== chain.id || !client || !info?.identity ||
              !info.canUpload}
          />
        )}
      {status && <Notice>{status}</Notice>}
      {error && <Notice error>{error}</Notice>}
    </section>
  );
}
