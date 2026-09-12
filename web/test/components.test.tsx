import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProposalCard } from "../app/components/proposals/proposal-card";
import { SubmitForm } from "../app/components/proposals/submit-form";
import { saveDownload } from "../app/lib/swarm";
import type { Proposal } from "../app/lib/proposals";

afterEach(cleanup);
const proposal: Proposal = {
  id: 0n,
  contentRef: `0x${"12".repeat(32)}`,
  proposer: `0x${"12".repeat(20)}`,
  recipient: `0x${"34".repeat(20)}`,
  cost: 12n,
  status: 0,
  projectId: 0n,
  revision: 1n,
  editor: `0x${"12".repeat(20)}`,
};
const handlers = {
  onRead: vi.fn(),
  onDownload: vi.fn(),
  onAttachment: vi.fn(),
  onReview: vi.fn(),
};

test("arbitrary proposal text is rendered as text and never interpreted as markup", () => {
  const body = '<img src=x onerror="alert(1)"><script>alert(1)</script>';
  const { container } = render(
    <ProposalCard
      {...handlers}
      proposal={proposal}
      symbol="TOK"
      decimals={0}
      busy={false}
      canReview={false}
      content={{ version: 1, title: "<h1>Idea</h1>", body, attachments: [] }}
    />,
  );
  expect(screen.getByText(body)).toBeTruthy();
  expect(container.querySelector("img,script,iframe")).toBeNull();
  expect(screen.queryByText("Accept proposal")).toBeNull();
});

test("only pending proposals show organizer actions and project zero is displayed correctly", () => {
  const view = render(
    <ProposalCard
      {...handlers}
      proposal={proposal}
      symbol="TOK"
      decimals={0}
      busy={false}
      canReview
    />,
  );
  fireEvent.click(screen.getByText("Reject proposal"));
  expect(handlers.onReview).toHaveBeenCalledWith(false);
  view.rerender(
    <ProposalCard
      {...handlers}
      proposal={{ ...proposal, status: 1 }}
      symbol="TOK"
      decimals={0}
      busy={false}
      canReview
    />,
  );
  expect(screen.queryByText("Reject proposal")).toBeNull();
  expect(screen.queryByText("Accept proposal")).toBeNull();
  expect(screen.getByText("#1")).toBeTruthy();
});

test("form exposes labels and accepts all file types", () => {
  render(
    <SubmitForm
      value={{ title: "", body: "", files: [], amount: "", recipient: "" }}
      onChange={vi.fn()}
      onUpload={vi.fn()}
      disabled={false}
      busy={false}
      symbol="TOK"
    />,
  );
  for (
    const label of [
      "Proposal title",
      "Your proposal",
      "Attachments",
      "Requested amount (TOK)",
      "Recipient wallet",
    ]
  ) expect(screen.getByLabelText(label)).toBeTruthy();
  expect(screen.getByLabelText("Attachments").getAttribute("accept"))
    .toBeNull();
});

test("retained attachments can be removed without changing the other files", () => {
  const attachments = [
    {
      reference: "12".repeat(32),
      name: "old.pdf",
      type: "application/pdf",
      size: 12,
    },
    { reference: "34".repeat(32), name: "keep.bin", type: "", size: 5 },
  ];
  const onChange = vi.fn();
  render(
    <SubmitForm
      value={{
        title: "Idea",
        body: "",
        files: [],
        attachments,
        amount: "1",
        recipient: "",
      }}
      onChange={onChange}
      onUpload={vi.fn()}
      disabled={false}
      busy={false}
      symbol="TOK"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Remove old.pdf" }));
  expect(onChange).toHaveBeenCalledWith(
    expect.objectContaining({ attachments: [attachments[1]] }),
  );
  expect(attachments).toHaveLength(2);
});

test("editing controls are restricted to eligible pending proposals", () => {
  const onEdit = vi.fn();
  const props = {
    ...handlers,
    proposal,
    symbol: "TOK",
    decimals: 0,
    busy: false,
    canReview: false,
    onEdit,
  };
  const view = render(<ProposalCard {...props} canEdit={false} />);
  expect(screen.queryByRole("button", { name: "Edit proposal" })).toBeNull();
  view.rerender(<ProposalCard {...props} canEdit />);
  fireEvent.click(screen.getByRole("button", { name: "Edit proposal" }));
  expect(onEdit).toHaveBeenCalledOnce();
  for (const status of [1, 2]) {
    view.rerender(
      <ProposalCard {...props} proposal={{ ...proposal, status }} canEdit />,
    );
    expect(screen.queryByRole("button", { name: "Edit proposal" })).toBeNull();
  }
});

test("downloads use a non-executable blob and sanitized filename", () => {
  const createObjectURL = vi.fn((_blob: Blob) => "blob:test");
  vi.stubGlobal(
    "URL",
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }),
  );
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(".._payload.html");
      expect(this.href).toBe("blob:test");
    });
  saveDownload(
    new TextEncoder().encode("<script>malicious()</script>"),
    "../payload.html",
  );
  expect(createObjectURL.mock.calls[0]?.[0]).toBeInstanceOf(Blob);
  expect((createObjectURL.mock.calls[0] as unknown as [Blob])[0].type).toBe(
    "application/octet-stream",
  );
  expect(click).toHaveBeenCalled();
  click.mockRestore();
});
