import type { GitSnapshot, Handoff } from "../types";
import { relativeTime, useI18n } from "../i18n";

/** The task in progress on one branch, as a checklist any agent (or person) can pick up. Text only, never HTML. */
export function ContinueCard(props: {
  handoff: Handoff;
  git?: GitSnapshot | null;
  projectName?: string;
  onCopy: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const h = props.handoff;
  const asked = h.requests?.at(-1);
  return (
    <article class={`card continue${h.status === "blocked" ? " is-blocked" : ""}`}>
      <header class="card-head">
        <span class="chip chip-continue">{t("continue.title")}</span>
        {props.projectName && <span class="fact">{props.projectName}</span>}
        {h.branch !== "-" && <span class="fact">{t("continue.branch", { branch: h.branch })}</span>}
        {h.status === "blocked" && <span class="badge badge-rejected">{t("continue.blocked")}</span>}
        <span class="meta">{t("continue.by", { agent: h.agent, when: relativeTime(t, h.updatedAt) })}</span>
      </header>
      <h3 class="card-title">{h.goal}</h3>
      {((asked && asked !== h.goal) || h.agentAt === null) && (
        <p class="card-why">
          {asked && asked !== h.goal ? (
            <>
              <strong>{t("continue.asked")}:</strong> {asked}{" "}
            </>
          ) : null}
          {h.agentAt === null && <span class="badge badge-auto">{t("continue.auto")}</span>}
        </p>
      )}

      <div class="progress">
        {h.done.length > 0 && (
          <div class="progress-col">
            <div class="progress-head">{t("continue.done")}</div>
            <ul class="checklist">
              {h.done.map((d, i) => (
                <li key={i} class="done-item">
                  <span class="tick" aria-hidden="true">✓</span>
                  {d}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div class="progress-col">
          {h.now && (
            <>
              <div class="progress-head">{t("continue.now")}</div>
              <p class="now">{h.now}</p>
            </>
          )}
          {h.next.length > 0 && (
            <>
              <div class="progress-head">{t("continue.next")}</div>
              <ol class="next-list">
                {h.next.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
        </div>
      </div>

      {(h.files.length > 0 || (props.git && props.git.changedCount > 0)) && (
        <div class="card-facts">
          {h.files.map((f) => (
            <code key={f} class="file">
              {f}
            </code>
          ))}
          {props.git &&
            props.git.changed
              .filter((f) => !h.files.includes(f))
              .map((f) => (
                <code key={`g-${f}`} class="file changed" title="git">
                  {f} •
                </code>
              ))}
        </div>
      )}
      {h.blockers && (
        <p class="warn small">
          <strong>{t("continue.blockers")}:</strong> {h.blockers}
        </p>
      )}
      {h.notes && (
        <p class="card-why">
          <strong>{t("continue.notes")}:</strong> {h.notes}
        </p>
      )}
      <div class="actions">
        <button class="btn btn-primary" onClick={props.onCopy}>
          {t("continue.copy")}
        </button>
        <button class="btn btn-quiet" onClick={props.onDone}>
          {t("continue.markDone")}
        </button>
      </div>
    </article>
  );
}
