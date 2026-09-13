import type { Attachment, ProjectResponse } from "../../lib/api-types";
import { NO_PITCH, PITCH_FAILED } from "../../lib/copy";
import { Button, Notice } from "../ui";

const kb = (size: number) => `${Math.max(1, Math.round(size / 1024))} KB`;

/** The proposal text as text nodes only; attachments are downloaded as binary. */
export function Pitch(
  { response: r, onRetry, onDownload }: {
    response: ProjectResponse;
    onRetry: () => void;
    onDownload: (file: Attachment) => void;
  },
) {
  if (r.contentStatus === "none") return <Notice>{NO_PITCH}</Notice>;
  if (r.contentStatus === "private") {
    return (
      <Notice>
        This pitch is private until voting opens. The proposer and organizer can read it from the
        proposal board using their Swarm ID.
      </Notice>
    );
  }
  if (r.contentStatus === "unavailable" || !r.content) {
    return (
      <Notice error>
        {PITCH_FAILED} <Button variant="secondary" onClick={onRetry}>Try again</Button>
      </Notice>
    );
  }
  return (
    <section aria-labelledby="pitch-heading" className="max-w-[var(--width-reading)]">
      <h2 id="pitch-heading" className="font-heading text-xl">Pitch</h2>
      <div className="mt-3 whitespace-pre-wrap break-words">{r.content.body}</div>
      {r.content.attachments.length > 0 && (
        <ul aria-label="Attachments" className="mt-4 flex flex-col gap-2 text-sm">
          {r.content.attachments.map((file) => (
            <li key={file.reference} className="flex flex-wrap items-center gap-3">
              <span>{file.name}</span>
              <span className="text-secondary">{kb(file.size)}</span>
              <Button variant="secondary" onClick={() => onDownload(file)} aria-label={`Download ${file.name}`}>Download</Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
