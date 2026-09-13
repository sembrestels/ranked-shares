import type { ReactNode } from "react";

const tones = {
  neutral: "border-edge-strong text-primary",
  success: "border-success text-success bg-info-bg",
  error: "border-error text-error bg-error-bg",
  info: "border-edge-strong text-secondary bg-info-bg",
  signal: "border-signal text-signal-text",
} as const;

export type BadgeTone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={`inline-block rounded-full border px-3 py-1 text-xs whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}
