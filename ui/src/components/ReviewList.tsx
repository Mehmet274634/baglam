import { useEffect, useState } from "preact/hooks";
import type { Api } from "../api";
import type { Entry } from "../types";
import { useI18n } from "../i18n";
import { useToast } from "../toast";
import { EntryCard } from "./EntryCard";

/** Records autonomous mode shared before the owner looked: keep them or undo. Renders nothing when empty. */
export function ReviewList(props: { api: Api; project: string | undefined; refresh: number; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [items, setItems] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    props.api
      .review(props.project)
      .then(setItems)
      .catch(() => setItems([]));
  }, [props.project, props.refresh]);

  const run = async (fn: () => Promise<unknown>, done: (r: unknown) => string, ids: string[]) => {
    setBusy(true);
    try {
      const r = await fn();
      toast(done(r));
      setItems((list) => list.filter((e) => !ids.includes(e.id)));
      props.onChanged();
    } catch (err) {
      toast(t("toast.error", { msg: (err as Error).message }), "error");
    } finally {
      setBusy(false);
    }
  };

  if (!items.length) return null;
  return (
    <section class="review">
      <div class="screen-head">
        <div>
          <h2>{t("review.title")}</h2>
          <p class="muted small">{t("review.subtitle")}</p>
        </div>
        {items.length > 1 && (
          <button
            class="btn"
            disabled={busy}
            onClick={() => run(() => props.api.keep(items.map((e) => e.id)), () => t("review.kept"), items.map((e) => e.id))}
          >
            {t("review.keepAll", { n: items.length })}
          </button>
        )}
      </div>
      <div class="list">
        {items.map((e) => (
          <EntryCard key={e.id} entry={e}>
            <div class="actions">
              <button class="btn btn-primary" disabled={busy} onClick={() => run(() => props.api.keep([e.id]), () => t("review.kept"), [e.id])}>
                {t("review.keep")}
              </button>
              <button
                class="btn btn-quiet danger-text"
                disabled={busy}
                onClick={() =>
                  run(
                    () => props.api.undo(e.id),
                    (r) => {
                      const res = r as { restored?: unknown; note?: string };
                      if (res?.restored) return t("review.restored");
                      if (res?.note) return t("review.notRestored", { note: res.note });
                      return t("review.undone");
                    },
                    [e.id],
                  )
                }
              >
                {t("review.undo")}
              </button>
            </div>
          </EntryCard>
        ))}
      </div>
    </section>
  );
}
