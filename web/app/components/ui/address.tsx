import { useState } from "react";
import { getAddress } from "viem";
import { shortAddress } from "../../lib/format";

export function Address(
  { address, full = false, copy = false }: { address: string; full?: boolean; copy?: boolean },
) {
  const [copied, setCopied] = useState(false);
  const checksummed = getAddress(address);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(checksummed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable: the full value is still in the title
    }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <code className="font-mono text-sm break-all" title={checksummed}>
        {full ? checksummed : shortAddress(checksummed)}
      </code>
      {copy && (
        <button
          type="button"
          className="text-sm text-secondary underline underline-offset-4 hover:text-primary"
          onClick={onCopy}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      )}
      <span role="status" className="sr-only">{copied ? "Address copied" : ""}</span>
    </span>
  );
}
