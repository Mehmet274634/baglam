import { useState } from "preact/hooks";
import { KINDS, type Entry, type EntryPatch, type SecretFinding } from "../types";
import { useI18n } from "../i18n";

/** Inline editor. `secrets` set means the last save was refused: show the warning and a "save anyway" button. */
export function EditForm(props: {
  entry: Entry;
  submitLabel: string;
  busy?: boolean;
  secrets?: SecretFinding[];
  onSubmit: (patch: EntryPatch, force: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [title, setTitle] = useState(props.entry.title);
  const [body, setBody] = useState(props.entry.body);
  const [rationale, setRationale] = useState(props.entry.rationale ?? "");
  const [kind, setKind] = useState(props.entry.kind);
  const patch = (): EntryPatch => ({ title, body, rationale, kind });
  // The warning applies to the text it was given for; once the text changes, saving goes through the check again.
  const [warnedText, setWarnedText] = useState<string | null>(null);
  const current = JSON.stringify([title, body, rationale]);
  if (props.secrets?.length && warnedText === null) setWarnedText(current);
  if (!props.secrets?.length && warnedText !== null) setWarnedText(null);
  const showWarning = !!props.secrets?.length && (warnedText === null || warnedText === current);

  return (
    <form
      class="edit"
      onSubmit={(ev) => {
        ev.preventDefault();
        props.onSubmit(patch(), false);
      }}
      onClick={(ev) => ev.stopPropagation()}
    >
      <div class="row">
        <label class="field grow">
          <span>{t("field.title")}</span>
          <input value={title} onInput={(e) => setTitle(e.currentTarget.value)} maxLength={200} required />
        </label>
        <label class="field">
          <span>{t("field.kind")}</span>
          <select value={kind} onChange={(e) => setKind(e.currentTarget.value as Entry["kind"])}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label class="field">
        <span>{t("field.body")}</span>
        <textarea value={body} rows={4} onInput={(e) => setBody(e.currentTarget.value)} maxLength={8000} required />
      </label>
      <label class="field">
        <span>{t("field.rationale")}</span>
        <textarea value={rationale} rows={2} onInput={(e) => setRationale(e.currentTarget.value)} maxLength={4000} />
      </label>
      {showWarning && (
        <div class="warn" role="alert">
          {t("secret.warning", { list: (props.secrets ?? []).map((s) => `${s.type} (${s.masked})`).join(", ") })}
        </div>
      )}
      <div class="actions">
        {showWarning ? (
          <button type="button" class="btn btn-danger" disabled={props.busy} onClick={() => props.onSubmit(patch(), true)}>
            {t("action.saveAnyway")}
          </button>
        ) : (
          <button type="submit" class="btn btn-primary" disabled={props.busy}>
            {props.submitLabel}
          </button>
        )}
        <button type="button" class="btn" onClick={props.onCancel}>
          {t("action.cancel")}
        </button>
      </div>
    </form>
  );
}
