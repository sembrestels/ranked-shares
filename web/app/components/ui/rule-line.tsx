import type { ReactNode } from "react";

/** One sentence at the moment of choice (design principle 3). */
export function RuleLine({ children }: { children: ReactNode }) {
  return (
    <p className="max-w-[var(--width-copy)] border-l-[length:var(--rule-width-accent)] border-signal pl-3 text-sm">
      {children}
    </p>
  );
}
