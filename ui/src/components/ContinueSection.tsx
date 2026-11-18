import { useEffect, useState } from "preact/hooks";
import type { Api } from "../api";
import type { GitSnapshot, Handoff } from "../types";
import { useI18n } from "../i18n";
import { useToast } from "../toast";
import { ContinueCard } from "./ContinueCard";

/** Every task in progress (for the chosen project, or all), each with what git shows changed since. */
export function ContinueSection(props: {
  api: Api;
  project: string | undefined;
  projectName: (key: string) => string;
  refresh: number;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<{ handoff: Handoff; git: GitSnapshot | null }[]>([]);

  useEffect(() => {
    let live = true;
    props.api
      .handoffs(props.project)
      .then((list) => Promise.all(list.map((h) => props.api.handoff(h.project, h.branch).catch(() => ({ handoff: h, git: null })))))
      .then((rows) => live && setItems(rows.map((r) => ({ handoff: r.handoff, git: r.git ?? null }))))
      .catch(() => live && setItems([]));
    return () => {
      live = false;
    };
  }, [props.project, props.refresh]);

  if (!items.length) return null;
  return (
    <section class="continue-section">
      <div class="screen-head">
        <div>
          <h1>{t("continue.title")}</h1>
          <p class="muted">{t("continue.subtitle")}</p>
        </div>
      </div>
      <div class="list">
        {items.map(({ handoff, git }) => (
          <ContinueCard
            key={`${handoff.project}/${handoff.branch}`}
            handoff={handoff}
            git={git}
            projectName={props.project ? undefined : props.projectName(handoff.project)}
            onCopy={async () => {
              try {
                const text = await props.api.resumePrompt(handoff.project, handoff.branch);
                await navigator.clipboard.writeText(text);
                toast(t("continue.copied"));
              } catch (err) {
                toast(t("toast.error", { msg: (err as Error).message }), "error");
              }
            }}
            onDone={() =>
              props.api
                .clearHandoff(handoff.project, handoff.branch)
                .then(() => {
                  toast(t("continue.markedDone"));
                  setItems((list) => list.filter((x) => x.handoff !== handoff));
                  props.onChanged();
                })
                .catch((err: Error) => toast(t("toast.error", { msg: err.message }), "error"))
            }
          />
        ))}
      </div>
    </section>
  );
}
