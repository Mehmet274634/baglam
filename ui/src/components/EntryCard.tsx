import type { ComponentChildren } from "preact";
import type { Entry, PendingEntry } from "../types";
import { relativeTime, useI18n } from "../i18n";

/** One record. All text is rendered as text nodes; nothing is ever parsed as HTML. */
export function EntryCard(props: {
  entry: Entry | PendingEntry;
  selected?: boolean;
  children?: ComponentChildren;
  onSelect?: () => void;
}) {
  const { t } = useI18n();
  const e = props.entry;
  const similar = "similar" in e ? e.similar : [];
  return (
    <article
      class={`card kind-${e.kind}${props.selected ? " selected" : ""}`}
      aria-current={props.selected ? "true" : undefined}
      onClick={props.onSelect}
    >
      <header class="card-head">
        <span class={`chip chip-${e.kind}`}>{t(`kind.${e.kind}`)}</span>
        {e.status !== "proposed" && <span class={`badge badge-${e.status}`}>{t(`status.${e.status}`)}</span>}
        {e.autoApproved && <span class="badge badge-auto">{t("card.auto")}</span>}
        <span class="meta">
          {t("card.from", { agent: e.sourceAgent })} · {relativeTime(t, e.createdAt)}
        </span>
      </header>
      <h3 class="card-title">{e.title}</h3>
      <p class="card-body">{e.body}</p>
      {e.rationale && (
        <p class="card-why">
          <strong>{t("card.why")}:</strong> {e.rationale}
        </p>
      )}
      {(e.tags.length > 0 || !e.audience.includes("*") || e.expiresAt || e.supersedes) && (
        <div class="card-facts">
          {e.tags.map((tag) => (
            <span key={tag} class="tag">
              #{tag}
            </span>
          ))}
          {!e.audience.includes("*") && <span class="fact">{t("card.onlyFor", { agents: e.audience.join(", ") })}</span>}
          {e.expiresAt && <span class="fact">{t("card.expires", { when: relativeTime(t, e.expiresAt) })}</span>}
          {e.supersedes && <span class="fact">{t("card.replaces", { id: e.supersedes })}</span>}
        </div>
      )}
      {similar.length > 0 && (
        <div class="similar">
          <div class="similar-head">{t("card.similar")}</div>
          {similar.map((s) => (
            <div key={s.id} class="similar-item">
              <span class={`chip chip-${s.kind}`}>{t(`kind.${s.kind}`)}</span>
              <span class={`badge badge-${s.status}`}>{t(`status.${s.status}`)}</span>
              <strong>{s.title}</strong>
              <span class="similar-body">{s.body}</span>
              <code class="id">{s.id}</code>
            </div>
          ))}
        </div>
      )}
      {props.children}
    </article>
  );
}
