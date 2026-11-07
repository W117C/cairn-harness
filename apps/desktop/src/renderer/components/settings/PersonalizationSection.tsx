import { CUSTOM_INSTRUCTIONS_MAX_BYTES } from "../../../../../../src/user-instructions";
import { STR } from "../../strings";
import "./agent-settings.css";

export function PersonalizationSection(props: {
  saved: string;
  draft: string | null;
  onDraft: (draft: string | null) => void;
  onSave: (value: string) => Promise<void>;
  saving: boolean;
  unavailable: boolean;
}): React.JSX.Element {
  const value = props.draft ?? props.saved;
  const bytes = new TextEncoder().encode(value).length;
  const dirty = value !== props.saved;
  const saveable = dirty && bytes <= CUSTOM_INSTRUCTIONS_MAX_BYTES && !props.saving && !props.unavailable;

  const save = (): void => {
    if (saveable) void props.onSave(value);
  };

  return (
    <form className="agent-settings-editor" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <label htmlFor="custom-instructions">{STR.personalization.label}</label>
      <textarea id="custom-instructions" className="agent-settings-textarea" value={value} rows={9}
        placeholder={STR.personalization.placeholder}
        aria-describedby="custom-instructions-limit"
        aria-invalid={bytes > CUSTOM_INSTRUCTIONS_MAX_BYTES}
        disabled={props.saving || props.unavailable}
        onChange={(event) => props.onDraft(event.target.value)}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            save();
          }
        }}
      />
      <div className="agent-settings-actions">
        <span className="sp-note" id="custom-instructions-limit">
          {bytes.toLocaleString()} / {CUSTOM_INSTRUCTIONS_MAX_BYTES.toLocaleString()} {STR.personalization.bytesSuffix}
          {bytes > CUSTOM_INSTRUCTIONS_MAX_BYTES ? STR.personalization.overLimit : dirty ? STR.personalization.dirty : ""}
        </span>
        <button className="mini-btn" type="button" disabled={!dirty || props.saving} onClick={() => props.onDraft(null)}>{STR.personalization.cancel}</button>
        <button className="mini-btn primary" type="submit" disabled={!saveable}>{props.saving ? STR.personalization.saving : STR.personalization.save}</button>
      </div>
    </form>
  );
}
