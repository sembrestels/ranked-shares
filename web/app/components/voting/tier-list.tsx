import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { FUNDING_TIERS, type FundingTier, type TierAssignments } from "../../lib/ballot-tiers";
import { Button } from "../ui";

type Destination = FundingTier | "unplaced";

function ProposalGroup({ label, children, empty, canMove, onMove }: {
  label: string;
  children: ReactNode;
  empty: boolean;
  canMove: boolean;
  onMove: () => void;
}) {
  return (
    <div className="tier-group">
      {empty
        ? <p className="tier-empty">{label === "Unplaced proposals" ? "All proposals placed" : "Drop proposals here"}</p>
        : <ul className="tier-proposals" aria-label={label}>{children}</ul>}
      {canMove && (
        <Button className="tier-move" variant="secondary" aria-label={`Move here: ${label}`} onClick={onMove}>
          Move here <span aria-hidden="true">↳</span>
        </Button>
      )}
    </div>
  );
}

export function TierList({ titles, assignments, disabled, onAssign }: {
  titles: string[];
  assignments: TierAssignments;
  disabled: boolean;
  onAssign: (id: number, tier: FundingTier | undefined) => void;
}) {
  const prefix = useId();
  const root = useRef<HTMLDivElement>(null);
  const dragged = useRef<number | undefined>(undefined);
  const focusAfterMove = useRef<number | undefined>(undefined);
  const [selected, setSelected] = useState<number>();
  const [dragging, setDragging] = useState(false);
  const [over, setOver] = useState<Destination>();
  const [announcement, setAnnouncement] = useState("");

  useLayoutEffect(() => {
    const id = focusAfterMove.current;
    if (id !== undefined && !disabled) {
      root.current?.querySelector<HTMLButtonElement>(`[data-proposal-id="${id}"]`)?.focus();
    }
    focusAfterMove.current = undefined;
  }, [assignments, selected, dragging, disabled]);

  useEffect(() => {
    if (disabled) {
      dragged.current = undefined;
      setSelected(undefined);
      setDragging(false);
      setOver(undefined);
      setAnnouncement("");
    }
  }, [disabled]);

  function clearSelection() {
    dragged.current = undefined;
    setSelected(undefined);
    setDragging(false);
    setOver(undefined);
  }

  function cancel() {
    const id = dragged.current ?? selected;
    if (id === undefined) return;
    focusAfterMove.current = id;
    clearSelection();
    setAnnouncement("Move cancelled. Your tiers have not changed.");
  }

  function move(id: number, destination: Destination) {
    if (disabled || titles[id] === undefined) return;
    const tier = destination === "unplaced" ? undefined : destination;
    focusAfterMove.current = id;
    clearSelection();
    const label = FUNDING_TIERS.find((t) => t.id === tier)?.label ?? "Unplaced proposals";
    if (assignments[id] === tier) {
      setAnnouncement(`${titles[id]} is already in ${label}.`);
      return;
    }
    onAssign(id, tier);
    setAnnouncement(`${titles[id]} moved to ${label}.`);
  }

  function dropEvents(destination: Destination) {
    const accept = (event: DragEvent<HTMLElement>) => {
      if (disabled || dragged.current === undefined) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      setOver(destination);
    };
    return {
      onDragEnter: accept,
      onDragOver: accept,
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(undefined);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (disabled || dragged.current === undefined) return;
        move(dragged.current, destination);
      },
    };
  }

  function group(destination: Destination, label: string) {
    const ids = titles.map((_, id) => id).filter((id) => (assignments[id] ?? "unplaced") === destination);
    const canMove = !disabled && !dragging && selected !== undefined && (assignments[selected] ?? "unplaced") !== destination;
    return (
      <ProposalGroup label={label} empty={ids.length === 0} canMove={canMove} onMove={() => {
        if (selected !== undefined) move(selected, destination);
      }}>
        {ids.map((id) => (
          <li key={id}>
            <Button
              variant="secondary"
              className="tier-proposal"
              data-proposal-id={id}
              aria-pressed={selected === id}
              aria-describedby={`${prefix}-instructions`}
              disabled={disabled}
              draggable={!disabled}
              onClick={() => {
                if (disabled) return;
                if (selected === id) cancel();
                else {
                  setSelected(id);
                  setAnnouncement(`${titles[id]} selected. Choose Move here in a destination, or press Escape to cancel.`);
                }
              }}
              onDragStart={(event) => {
                if (disabled) { event.preventDefault(); return; }
                dragged.current = id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", String(id));
                setSelected(id);
                setDragging(true);
                setAnnouncement(`Moving ${titles[id]}. Drop it in a tier or back in Unplaced proposals.`);
              }}
              onDragEnd={() => {
                if (dragged.current !== undefined) cancel();
              }}
            >
              <span className="tier-grip" aria-hidden="true">{selected === id ? "✓" : "⠿"}</span>
              <span>{titles[id]}</span>
            </Button>
          </li>
        ))}
      </ProposalGroup>
    );
  }

  return (
    <div className="tier-list" ref={root} onKeyDown={(event) => {
      if (event.key === "Escape" && selected !== undefined) {
        event.preventDefault();
        cancel();
      }
    }}>
      <div className="tier-intro">
        <h2>Set your funding priorities</h2>
        <p id={`${prefix}-instructions`}>Drag proposals into a tier, or select a proposal and choose “Move here”.</p>
        <p className="hint">Proposals in the same row have equal priority. Unplaced proposals sit below all three tiers.</p>
      </div>
      <section
        className="tier-unplaced"
        aria-labelledby={`${prefix}-unplaced`}
        data-drag-over={over === "unplaced" || undefined}
        {...dropEvents("unplaced")}
      >
        <h3 id={`${prefix}-unplaced`}>Unplaced proposals <span className="tier-count">{titles.filter((_, id) => assignments[id] === undefined).length}</span></h3>
        {group("unplaced", "Unplaced proposals")}
      </section>
      <table className="tier-table" aria-label="Funding priorities">
        <tbody>
          {FUNDING_TIERS.map(({ id, grade, label }) => (
            <tr key={id} className={`tier-row tier-${id}`} data-drag-over={over === id || undefined} {...dropEvents(id)}>
              <th scope="row">
                <span className="tier-grade"><b>{grade}</b>-Tier</span>
                <span className="tier-label">{label}</span>
              </th>
              <td>{group(id, label)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tier-status hint" role="status" aria-atomic="true">{disabled ? "Submitting your ballot. Proposal movement is paused." : announcement || "You can move proposals between tiers at any time before submitting your ballot."}</p>
    </div>
  );
}
