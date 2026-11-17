import { useEffect, useState } from "preact/hooks";
import type { Api } from "../api";
import type { ProjectRow } from "../types";
import { relativeTime, useI18n } from "../i18n";
import { useToast } from "../toast";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function Projects(props: { api: Api; refresh: number; onChanged: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const [showArchived, setShowArchived] = useState(false);
  const [rows, setRows] = useState<ProjectRow[] | null>(null);
  const [renaming, setRenaming] = useState<{ key: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ key: string; typed: string } | null>(null);

  const load = () =>
    props.api
      .projects(showArchived)
      .then(setRows)
      .catch((err: Error) => toast(t("toast.error", { msg: err.message }), "error"));
  useEffect(() => void load(), [showArchived, props.refresh]);

  const run = (fn: () => Promise<unknown>) =>
    fn()
      .then(() => {
        toast(t("toast.saved"));
        setRenaming(null);
        setDeleting(null);
        props.onChanged();
        return load();
      })
      .catch((err: Error) => toast(t("toast.error", { msg: err.message }), "error"));

  return (
    <section>
      <div class="screen-head">
        <div>
          <h1>{t("projects.title")}</h1>
          <p class="muted">{t("projects.subtitle")}</p>
        </div>
        <label class="check">
          <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.currentTarget.checked)} />
          {t("projects.showArchived")}
        </label>
      </div>
      {rows === null ? (
        <p class="muted">{t("loading")}</p>
      ) : rows.length === 0 ? (
        <div class="empty small-empty">
          <p class="muted">{t("projects.empty")}</p>
        </div>
      ) : (
        <div class="list">
          {rows.map((p) => {
            const managed = UUID.test(p.key);
            return (
              <article key={p.key} class={`card project${p.archived ? " archived" : ""}`}>
                <header class="card-head">
                  {renaming?.key === p.key ? (
                    <form
                      class="row grow"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(() => props.api.renameProject(p.key, renaming.name));
                      }}
                    >
                      <input
                        aria-label={t("field.name")}
                        value={renaming.name}
                        autoFocus
                        onInput={(e) => setRenaming({ key: p.key, name: e.currentTarget.value })}
                      />
                      <button class="btn btn-primary" type="submit">
                        {t("action.save")}
                      </button>
                      <button class="btn" type="button" onClick={() => setRenaming(null)}>
                        {t("action.cancel")}
                      </button>
                    </form>
                  ) : (
                    <h3 class="card-title">{p.name}</h3>
                  )}
                  {p.archived && <span class="badge badge-retired">{t("projects.archived")}</span>}
                </header>
                <p class="muted small mono">{p.path ?? p.key}</p>
                <p class="small">
                  {t("projects.counts", { active: p.approved, pending: p.pending })}
                  {p.lastActivity ? ` · ${t("projects.lastActivity", { when: relativeTime(t, p.lastActivity) })}` : ""}
                </p>
                {!managed && <p class="muted small">{t("projects.notInit")}</p>}
                {deleting?.key === p.key ? (
                  <form
                    class="danger-zone"
                    onSubmit={(e) => {
                      e.preventDefault();
                      run(() => props.api.deleteProject(p.key, deleting.typed));
                    }}
                  >
                    <label class="field">
                      <span>{t("projects.deleteConfirm", { name: p.name })}</span>
                      <input value={deleting.typed} autoFocus onInput={(e) => setDeleting({ key: p.key, typed: e.currentTarget.value })} />
                    </label>
                    <div class="actions">
                      <button class="btn btn-danger" type="submit" disabled={deleting.typed !== p.name}>
                        {t("action.delete")}
                      </button>
                      <button class="btn" type="button" onClick={() => setDeleting(null)}>
                        {t("action.cancel")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div class="actions">
                    {managed && !renaming && (
                      <button class="btn btn-quiet" onClick={() => setRenaming({ key: p.key, name: p.name })}>
                        {t("action.rename")}
                      </button>
                    )}
                    {managed &&
                      (p.archived ? (
                        <button class="btn btn-quiet" onClick={() => run(() => props.api.restoreProject(p.key))}>
                          {t("action.restore")}
                        </button>
                      ) : (
                        <button class="btn btn-quiet" onClick={() => run(() => props.api.archiveProject(p.key))}>
                          {t("action.archive")}
                        </button>
                      ))}
                    <button class="btn btn-quiet danger-text" onClick={() => setDeleting({ key: p.key, typed: "" })}>
                      {t("action.delete")}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
