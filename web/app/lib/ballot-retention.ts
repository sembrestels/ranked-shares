import { ExpirationTime } from "@arkiv-network/sdk";

export const BALLOT_RETENTION_SECONDS = 15n * 24n * 60n * 60n;

export function ballotRetentionUntil(votingDeadline: bigint): bigint {
  return votingDeadline + BALLOT_RETENTION_SECONDS;
}

/** Use the Arkiv head timestamp, not the browser clock. The network enforces a
 * block height; two-second block conversion is only a wall-clock estimate.
 * ADR: store-ballots-in-arkiv-and-calculate-live-results-in-the-browser.
 */
export function ballotExpiry(
  votingDeadline: bigint,
  head: { number: bigint; timestamp: bigint },
) {
  const until = ballotRetentionUntil(votingDeadline);
  if (votingDeadline <= 0n || head.number < 0n || until <= head.timestamp) {
    throw new Error("The ballot retention deadline has already passed or is invalid.");
  }
  const expiresAt = head.number + (until - head.timestamp + 1n) / 2n;
  if (expiresAt >= (1n << 64n) - 1n) {
    throw new Error("The ballot expiry exceeds Arkiv's supported block range.");
  }
  return { until, expiresAt, expires: ExpirationTime.atBlock(expiresAt) };
}
