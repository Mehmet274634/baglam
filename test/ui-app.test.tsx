// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/preact";
import { dict, pickLanguage, I18nProvider } from "../ui/src/i18n.js";
import { EntryCard } from "../ui/src/components/EntryCard.js";
import { Inbox } from "../ui/src/screens/Inbox.js";
import { ApiError, type Api } from "../ui/src/api.js";
import { ToastProvider } from "../ui/src/toast.js";
import type { Entry, PendingEntry } from "../ui/src/types.js";
import { EVENT_TYPES } from "../src/portable.js";

afterEach(cleanup);

let n = 0;
function entry(over: Partial<Entry> = {}): PendingEntry {
  n++;
  return {
    id: `c${n}`, project: "p", kind: "decision", title: `Title ${n}`, body: `Body ${n}`, rationale: null, tags: [],
    audience: ["*"], status: "proposed", sourceAgent: "claude-code", createdAt: Date.now() - 60_000, decidedAt: null,
    decidedBy: null, decisionNote: null, expiresAt: null, supersedes: null, supersededBy: null, editedAt: null,
    autoApproved: false, similarTo: [], similar: [], ...over,
  };
}

function fakeApi(items: PendingEntry[], over: Partial<Api> = {}): Api {
  const api = {
    pending: vi.fn(async () => items),
    approve: vi.fn(async (id: string) => ({ ...items.find((e) => e.id === id)!, status: "approved" as const })),
    reject: vi.fn(async (id: string) => ({ ...items.find((e) => e.id === id)!, status: "rejected" as const })),
    edit: vi.fn(async (id: string) => ({ ...items.find((e) => e.id === id)!, status: "approved" as const })),
    approveAll: vi.fn(async () => ({ approved: items.length })),
    ...over,
  };
  return api as unknown as Api;
}

describe("i18n", () => {
  it("has the same keys in tr and en", () => {
    expect(Object.keys(dict.tr).sort()).toEqual(Object.keys(dict.en).sort());
    for (const v of [...Object.values(dict.tr), ...Object.values(dict.en)]) expect(v.trim()).not.toBe("");
  });

  it("names every kind of history event the store writes (no raw keys like history.imported)", () => {
    for (const type of EVENT_TYPES) {
      expect(Object.keys(dict.en), type).toContain(`history.${type}`);
    }
  });

  it("picks Turkish for tr-TR, English otherwise", () => {
    expect(pickLanguage("tr-TR")).toBe("tr");
    expect(pickLanguage("tr")).toBe("tr");
    expect(pickLanguage("en-US")).toBe("en");
    expect(pickLanguage("de-DE")).toBe("en");
    expect(pickLanguage(undefined)).toBe("en");
  });
});

describe("EntryCard", () => {
  it("renders record text as text", () => {
    const { container } = render(
      <I18nProvider lang="en">
        <EntryCard entry={entry({ title: "<b>bold?</b>", body: "<img src=x onerror=alert(1)>" })} />
      </I18nProvider>,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("b")).toBeNull();
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
    expect(container.textContent).toContain("<b>bold?</b>");
  });
});

describe("Inbox", () => {
  it("inbox keyboard: j/k move, a approves the selected card", async () => {
    const items = [entry(), entry(), entry()];
    const api = fakeApi(items);
    render(
      <I18nProvider lang="en">
        <Inbox api={api} project={undefined} refresh={0} onChanged={() => {}} />
      </I18nProvider>,
    );
    await screen.findByText(items[0].title);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });
    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(api.approve).toHaveBeenCalledWith(items[1].id, undefined));
  });

  it("keys typed into a form field are not shortcuts", async () => {
    const items = [entry()];
    const api = fakeApi(items);
    render(
      <I18nProvider lang="en">
        <Inbox api={api} project={undefined} refresh={0} onChanged={() => {}} />
      </I18nProvider>,
    );
    await screen.findByText(items[0].title);
    fireEvent.keyDown(window, { key: "r" }); // opens the reject note
    const note = await screen.findByLabelText("Reason (optional)");
    fireEvent.keyDown(note, { key: "a" });
    expect(api.approve).not.toHaveBeenCalled();
  });

  it("edit with a secret asks for confirmation", async () => {
    const items = [entry()];
    const edit = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "secret", { secrets: [{ type: "AWS access key", masked: "AKIA…" }] }))
      .mockResolvedValueOnce({ ...items[0], status: "approved" });
    const api = fakeApi(items, { edit } as Partial<Api>);
    render(
      <I18nProvider lang="en">
        <Inbox api={api} project={undefined} refresh={0} onChanged={() => {}} />
      </I18nProvider>,
    );
    await screen.findByText(items[0].title);
    fireEvent.click(screen.getByRole("button", { name: "Edit & approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save & approve" }));
    expect(await screen.findByText(/AWS access key \(AKIA…\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save anyway" }));
    await waitFor(() => expect(edit).toHaveBeenLastCalledWith(items[0].id, expect.any(Object), { approve: true, force: true }));
  });

  it("changing the text after a secret warning brings back the normal save", async () => {
    const items = [entry()];
    const edit = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(409, "secret", { secrets: [{ type: "AWS access key", masked: "AKIA…" }] }))
      .mockResolvedValueOnce({ ...items[0], status: "approved" });
    render(
      <I18nProvider lang="en">
        <Inbox api={fakeApi(items, { edit } as Partial<Api>)} project={undefined} refresh={0} onChanged={() => {}} />
      </I18nProvider>,
    );
    await screen.findByText(items[0].title);
    fireEvent.click(screen.getByRole("button", { name: "Edit & approve" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save & approve" }));
    await screen.findByRole("button", { name: "Save anyway" });
    fireEvent.input(screen.getByLabelText("Content"), { target: { value: "clean text" } });
    fireEvent.click(await screen.findByRole("button", { name: "Save & approve" }));
    await waitFor(() => expect(edit).toHaveBeenLastCalledWith(items[0].id, expect.objectContaining({ body: "clean text" }), { approve: true }));
  });

  it("a proposal decided elsewhere shows a translated message and leaves the list", async () => {
    const items = [entry(), entry()];
    const approve = vi.fn().mockRejectedValue(new ApiError(409, "entry c1 is not pending (status: rejected)"));
    render(
      <I18nProvider lang="tr">
        <ToastProvider>
          <Inbox api={fakeApi(items, { approve } as Partial<Api>)} project={undefined} refresh={0} onChanged={() => {}} />
        </ToastProvider>
      </I18nProvider>,
    );
    await screen.findByText(items[0].title);
    fireEvent.keyDown(window, { key: "a" });
    expect(await screen.findByText(/başka bir yerde karar verilmiş/)).toBeTruthy();
    await waitFor(() => expect(screen.queryByText(items[0].title)).toBeNull());
    expect(screen.queryByText(/not pending/)).toBeNull();
  });

  it("approve all sends the ids that were shown", async () => {
    const items = [entry(), entry()];
    const approveAll = vi.fn(async () => ({ approved: 2, skipped: 0 }));
    vi.stubGlobal("confirm", () => true);
    render(
      <I18nProvider lang="en">
        <Inbox api={fakeApi(items, { approveAll } as Partial<Api>)} project="p" refresh={0} onChanged={() => {}} />
      </I18nProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Approve all (2)" }));
    await waitFor(() => expect(approveAll).toHaveBeenCalledWith(items.map((e) => e.id)));
    vi.unstubAllGlobals();
  });

  it("empty inbox teaches the first step", async () => {
    render(
      <I18nProvider lang="en">
        <Inbox api={fakeApi([])} project={undefined} refresh={0} onChanged={() => {}} />
      </I18nProvider>,
    );
    expect(await screen.findByText(/Nothing to review/)).toBeTruthy();
  });
});
