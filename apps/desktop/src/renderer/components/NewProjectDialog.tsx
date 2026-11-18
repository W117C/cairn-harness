// 新建项目 Dialog（brief 第四节）：居中弹窗，取代侧栏内联表单。
// 同屏三步：选模板（卡片网格，清单以现有 projectTemplates 为准）→ 填名字（实时校验）→ 选位置
// （默认 ~/Cairn Projects，「更改…」走系统选择器；显示「将创建在：」预览）。
// 全程零路径手输（原则 1）；文案走 STR。
import { useRef, useState } from "react";
import { isCompositionEnter } from "../ime";
import { Atom, BarChart3, ClipboardList, FolderPlus, LayoutTemplate, X } from "lucide-react";
import { STR } from "../strings";
import { applyRadioNavigation } from "../radio-nav";
import { ModalSurface } from "./ModalSurface";
import { projectNameProblem } from "../../../../../src/main/project-name";

export interface TemplateCard {
  id: string;
  name: string;
  description: string;
}

/** 模板 → 图标（未知模板兜底 FolderPlus——不因模板目录扩项而空图标）。 */
function templateIcon(id: string): React.JSX.Element {
  if (id === "static-site") return <LayoutTemplate size={16} />;
  if (id === "form-widget") return <ClipboardList size={16} />;
  if (id === "data-panel") return <BarChart3 size={16} />;
  if (id === "react-vite") return <Atom size={16} />;
  return <FolderPlus size={16} />;
}

/** 名字实时校验（返回错误文案或 null）。
 *  **规矩不在本文件**：它是文件夹名的规矩，本体在 `src/main/project-name.ts`，与核心建目录那条
 *  路径共用一份（2026-11-18 审计：此前这里只查 `\ /` 与控制字符，`a:b`、65 字符、`.隐藏`、`结尾点`
 *  四档都是「对话框绿、点创建才被核心拒」——实时校验在那些字符上是假的）。这里只把档位翻成 STR 文案。 */
export function validateProjectName(name: string, existingNames: readonly string[]): string | null {
  const problem = projectNameProblem(name);
  if (problem !== null) {
    switch (problem.reason) {
      case "empty": return STR.newProject.nameEmpty;
      case "too-long": return STR.newProject.nameTooLong;
      case "bad-char": return STR.newProject.nameInvalid;
      case "leading-dot": return STR.newProject.nameLeadingDot;
      case "trailing-dot": return STR.newProject.nameTrailingDot;
    }
  }
  if (existingNames.includes(name.trim())) return STR.newProject.nameTaken;
  return null;
}

export function NewProjectDialog(props: {
  templates: readonly TemplateCard[];
  /** 已在场项目名（重名校验）。 */
  existingNames: readonly string[];
  onClose: () => void;
  onPickDirectory: () => Promise<string | null>;
  /** 成功后由 App 关窗/刷新/聚焦输入框；reject ⇒ 错误行内 fail-visible。 */
  onCreate: (input: { name: string; templateId: string; parentDir?: string }) => Promise<void>;
}): React.JSX.Element {
  const [templateId, setTemplateId] = useState(props.templates[0]?.id ?? "");
  const [name, setName] = useState("");
  const [parentDir, setParentDir] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameInput = useRef<HTMLInputElement | null>(null);
  const nameError = validateProjectName(name, props.existingNames);
  const showNameError = name.trim() !== "" && nameError !== null;
  const previewParent = parentDir ?? STR.newProject.defaultParent;
  const close = () => { if (!busy) props.onClose(); };
  /** 回车 = 提交（按钮同一条路；busy / 校验失败时不动，错误照样上屏）。 */
  const submit = () => {
    if (busy) return;
    const trimmed = name.trim();
    const invalid = validateProjectName(trimmed, props.existingNames);
    if (invalid !== null) { setError(invalid); return; }
    setBusy(true);
    setError(null);
    void props.onCreate({
      name: trimmed,
      templateId,
      ...(parentDir !== null ? { parentDir } : {}),
    }).then(
      () => { props.onClose(); },
      (err: unknown) => { setError(STR.newProject.failed.replace("{reason}", err instanceof Error ? err.message : String(err))); setBusy(false); },
    );
  };
  return (
    <div className="modal-backdrop" role="presentation" onClick={close}>
      <ModalSurface
        className="modal-card modal-wide"
        label={STR.newProject.title}
        onClose={close}
        aria-busy={busy}
        initialFocusRef={nameInput}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="modal-head">
          <span>{STR.newProject.title}</span>
          <button className="iconbtn sm" aria-label={STR.common.cancel} title={STR.common.cancel} disabled={busy} onClick={close}>
            <X size={13} />
          </button>
        </div>

        <div className="modal-field">
          <span>{STR.newProject.templateLabel}</span>
          <div className="tpl-grid" role="radiogroup" aria-label={STR.newProject.templateLabel}>
            {props.templates.map((t) => (
              <button
                key={t.id}
                type="button"
                className="tpl-card"
                role="radio"
                aria-checked={templateId === t.id}
                tabIndex={templateId === t.id ? 0 : -1}
                data-on={templateId === t.id}
                title={t.description}
                disabled={busy}
                onClick={() => { setTemplateId(t.id); }}
                onKeyDown={(e) => {
                  const current = props.templates.findIndex((template) => template.id === templateId);
                  applyRadioNavigation(e, current, props.templates.length, (index) => {
                    const target = props.templates[index];
                    if (target !== undefined) setTemplateId(target.id);
                  });
                }}
              >
                <span className="tpl-ico" aria-hidden="true">{templateIcon(t.id)}</span>
                <span className="tpl-name">{t.name}</span>
                <span className="tpl-desc">{t.description}</span>
              </button>
            ))}
          </div>
        </div>

        <label className="modal-field">
          <span>{STR.newProject.nameLabel}</span>
          <input
            ref={nameInput}
            aria-label={STR.newProject.nameLabel}
            placeholder={STR.newProject.namePlaceholder}
            value={name}
            disabled={busy}
            onChange={(e) => { setName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !isCompositionEnter(e, null)) { e.preventDefault(); submit(); } }}
          />
          {showNameError && <span className="form-error" role="alert">{nameError}</span>}
        </label>

        <div className="modal-field">
          <span>{STR.newProject.locationLabel}</span>
          <div className="modal-row">
            <code className="modal-path" title={previewParent}>{previewParent}</code>
            <button
              type="button"
              className="mini-btn"
              title={STR.newProject.locationHint}
              disabled={busy}
              onClick={() => {
                setError(null);
                void props.onPickDirectory().then((picked) => { if (picked !== null) setParentDir(picked); }).catch((err: unknown) => {
                  setError(STR.newProject.locationFailed.replace("{reason}", err instanceof Error ? err.message : String(err)));
                });
              }}
            >
              {STR.newProject.locationChange}
            </button>
          </div>
          <span className="sp-dim">{STR.newProject.locationHint}</span>
          <span className="sp-dim">{STR.newProject.preview.replace("{path}", `${previewParent}/${name.trim() !== "" ? name.trim() : "…"}`)}</span>
        </div>

        {error !== null && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-foot">
          <button className="mini-btn" title={STR.common.cancel} disabled={busy} onClick={close}>{STR.common.cancel}</button>
          <button
            className="mini-btn primary"
            title={STR.newProject.title}
            disabled={busy || nameError !== null || templateId === ""}
            onClick={submit}
          >
            {busy ? STR.common.creating : STR.common.create}
          </button>
        </div>
      </ModalSurface>
    </div>
  );
}
