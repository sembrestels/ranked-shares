import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Badge } from "./badge";

export function Button(
  { variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "danger";
  },
) {
  return (
    <button
      type="button"
      {...props}
      className={`button ${variant} ${props.className || ""}`}
    />
  );
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="input" />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className="input" />;
}
/** A native select in the Input's clothes: the browser keeps the keyboard, the
 * screen reader and the phone picker; only the closed control is drawn by us. */
export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="select">
      <select {...props} className="input" />
      <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </span>
  );
}
export function Label(
  { htmlFor, children }: { htmlFor: string; children: ReactNode },
) {
  return <label htmlFor={htmlFor}>{children}</label>;
}
export function Field(
  { id, label, hint, children }: {
    id: string;
    label: string;
    hint?: string;
    children: ReactNode;
  },
) {
  return (
    <div className="field">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}
export function Notice(
  { children, error = false }: { children: ReactNode; error?: boolean },
) {
  return (
    <p
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </p>
  );
}
/** Kept as a thin wrapper over Badge: still imported by voting/ and liquidity/
 * components owned by other sessions. New code should use Badge directly. */
export function Status(
  { children, status = 0 }: { children: ReactNode; status?: number },
) {
  const tone = (["info", "success", "error"] as const)[status] ?? "neutral";
  return <Badge tone={tone}>{children}</Badge>;
}

export function ErrorPopup(
  { title, children, actions, onDismiss }: {
    title: string;
    children: ReactNode;
    actions?: ReactNode;
    onDismiss: () => void;
  },
) {
  return (
    <aside className="error-popup" aria-label={title}>
      <div role="alert">
        <strong>{title}</strong>
        <p>{children}</p>
      </div>
      <div className="actions">
        {actions}
        <Button variant="secondary" onClick={onDismiss}>Dismiss</Button>
      </div>
    </aside>
  );
}
export function Fact(
  { label, children }: { label: string; children: ReactNode },
) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export { Money } from "./money";
export { Address } from "./address";
export { Countdown } from "./countdown";
export { Badge, type BadgeTone } from "./badge";
export { Skeleton } from "./skeleton";
export { SupportBar } from "./support-bar";
export { StageStep } from "./stage-step";
export { RuleLine } from "./rule-line";
