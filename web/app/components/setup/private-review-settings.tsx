import { Button, Notice } from "../ui";

export function PrivateReviewSettings(
  {
    supported,
    registered,
    locked,
    matches,
    busy,
    votingOpen,
    preparedCount,
    onRegister,
    onPrepare,
    onPublish,
  }: {
    supported: boolean;
    registered: boolean;
    locked: boolean;
    matches: boolean;
    busy: boolean;
    votingOpen: boolean;
    preparedCount?: number;
    onRegister: () => void;
    onPrepare: () => void;
    onPublish: () => void;
  },
) {
  return (
    <section className="surface stack" aria-label="Private proposal review">
      <div className="section-heading">
        <h2>Private proposal review</h2>
        <span className="eyebrow">Organizer settings</span>
      </div>
      {!supported
        ? (
          <Notice>
            This deployment needs an updated round contract to support private review.
          </Notice>
        )
        : (
          <>
            <p>
              Proposers encrypt their text and attachments for their Swarm ID and yours. Both of you
              can edit during review. Accepted proposals become public when you open voting.
            </p>
            {!registered && (
              <Notice>
                {locked
                  ? "This round already has public submissions. Create a new round to enable private review."
                  : "Connect your Swarm ID and register its sharing key before inviting proposals."}
              </Notice>
            )}
            {registered && (
              <Notice>
                {matches
                  ? "Your connected Swarm ID matches the registered organizer key."
                  : "Connect the Swarm ID registered for this round to read private proposals and publish them for voting."}
              </Notice>
            )}
            {!votingOpen && !locked && (
              <Button disabled={busy} onClick={onRegister}>
                {registered ? "Replace organizer sharing key" : "Enable private review"}
              </Button>
            )}
            {registered && (
              <p className="hint">
                The sharing key is locked after the first submission. Keep access to this Swarm ID
                when changing organizer wallets.
              </p>
            )}
            {!votingOpen && registered && (
              <div className="stack">
                {preparedCount === undefined
                  ? (
                    <Button variant="secondary" disabled={busy || !matches} onClick={onPrepare}>
                      Prepare voting
                    </Button>
                  )
                  : (
                    <>
                      <p>
                        {preparedCount} accepted{" "}
                        {preparedCount === 1 ? "proposal is" : "proposals are"}{" "}
                        ready to publish. Rejected proposals and previous drafts remain private.
                      </p>
                      <p className="hint">
                        Publishing releases decryption keys with the transaction. Treat publication
                        as permanent from the moment you send it, even if the transaction fails.
                      </p>
                      <Button disabled={busy || !matches} onClick={onPublish}>
                        Publish accepted proposals and open voting
                      </Button>
                    </>
                  )}
              </div>
            )}
          </>
        )}
    </section>
  );
}
