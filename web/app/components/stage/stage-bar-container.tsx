import { useState } from "react";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { useRound } from "../../context/providers";
import { useNow } from "../../hooks/use-now";
import { useRoundSnapshot } from "../../hooks/use-snapshot";
import { sendClose } from "../../lib/close";
import { errorMessage } from "../../lib/proposals";
import { Notice, Skeleton } from "../ui";
import { StageBar } from "./stage-bar";

/** Wires the stage bar to the snapshot, the clock, and the close action. */
export function StageBarContainer() {
  const round = useRoundSnapshot();
  const now = useNow(60_000);
  const { address } = useAccount();
  const { data: wallet } = useWalletClient();
  const publicClient = usePublicClient();
  const { pool, markMined } = useRound();
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string>();

  async function closeBatch() {
    if (!wallet || !pool || !publicClient) return;
    setClosing(true);
    setCloseError(undefined);
    try {
      const receipt = await sendClose(publicClient, wallet, pool);
      markMined(Number(receipt.blockNumber));
    } catch (e) {
      setCloseError(errorMessage(e));
    } finally {
      setClosing(false);
    }
  }

  if (!pool) return null;
  if (!round.data) {
    return round.isError ? <Notice error>Could not load the round: {errorMessage(round.error)}</Notice> : <Skeleton lines={1} />;
  }
  return (
    <StageBar
      snapshot={round.data}
      now={now}
      canClose={!!address && !!wallet}
      closing={closing}
      onCloseBatch={closeBatch}
      closeError={closeError}
    />
  );
}
