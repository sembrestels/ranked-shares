import { Button, Field, Input, Textarea } from "../ui";
import type { Draft } from "../../lib/swarm";
import { useId } from "react";

export type FormValues = Draft & { amount: string; recipient: string };
export function SubmitForm(
  {
    value,
    onChange,
    onUpload,
    disabled,
    busy,
    symbol,
    submitLabel = "Upload to Swarm",
  }: {
    value: FormValues;
    onChange: (value: FormValues) => void;
    onUpload: () => void;
    disabled: boolean;
    busy: boolean;
    symbol: string;
    submitLabel?: string;
  },
) {
  const id = useId();
  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault();
        onUpload();
      }}
    >
      <p className="hint">
        Title, amount, and recipient are required. Include proposal text,
        attachments, or both.
      </p>
      <fieldset disabled={busy} className="stack">
        <Field id={`${id}-title`} label="Proposal title">
          <Input
            id={`${id}-title`}
            required
            value={value.title}
            onChange={(e) => onChange({ ...value, title: e.target.value })}
            placeholder="What would you like to make happen?"
          />
        </Field>
        <Field
          id={`${id}-body`}
          label="Your proposal"
          hint="Write freely. Your text is preserved as written; attach any supporting files below."
        >
          <Textarea
            id={`${id}-body`}
            rows={10}
            value={value.body}
            onChange={(e) => onChange({ ...value, body: e.target.value })}
            aria-describedby={`${id}-body-hint`}
            placeholder="The idea, who it helps, and what you need to deliver it…"
          />
        </Field>
        <Field
          id={`${id}-files`}
          label="Attachments"
          hint="All file types are welcome. Files are downloaded for review."
        >
          <Input
            id={`${id}-files`}
            type="file"
            multiple
            aria-describedby={`${id}-files-hint`}
            onChange={(e) =>
              onChange({ ...value, files: Array.from(e.target.files || []) })}
          />
        </Field>
        {!!value.attachments?.length && (
          <ul className="files" aria-label="Existing attachments">
            {value.attachments.map((file, index) => (
              <li key={`${file.reference}-${index}`}>
                <span>{file.name} · {file.size.toLocaleString()} bytes</span>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() =>
                    onChange({
                      ...value,
                      attachments: value.attachments?.filter((_, i) =>
                        i !== index
                      ),
                    })}
                >
                  Remove {file.name}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {value.files.length > 0 && (
          <ul className="files">
            {value.files.map((file, index) => (
              <li key={index}>
                {file.name} · {file.size.toLocaleString()} bytes
              </li>
            ))}
          </ul>
        )}
        <div className="columns">
          <Field id={`${id}-amount`} label={`Requested amount (${symbol})`}>
            <Input
              id={`${id}-amount`}
              required
              inputMode="decimal"
              value={value.amount}
              placeholder="0.00"
              onChange={(e) => onChange({ ...value, amount: e.target.value })}
            />
          </Field>
          <Field id={`${id}-recipient`} label="Recipient wallet">
            <Input
              id={`${id}-recipient`}
              required
              spellCheck={false}
              value={value.recipient}
              placeholder="0x…"
              onChange={(e) =>
                onChange({ ...value, recipient: e.target.value })}
            />
          </Field>
        </div>
      </fieldset>
      <p className="hint">
        The proposal and attachments will be public on Swarm. Submitting sends
        the proposal to the organizer for review.
      </p>
      <Button type="submit" disabled={disabled || busy}>
        {busy ? "Preparing proposal…" : submitLabel}
      </Button>
    </form>
  );
}
