// 新建项目 Dialog（brief 第四节）：居中弹窗，取代侧栏内联表单。
// 同屏三步：选模板（卡片网格，清单以现有 projectTemplates 为准）→ 填名字（实时校验）→ 选位置
// （默认 ~/Cairn Projects，「更改…」走系统选择器；显示「将创建在：」预览）。
// 全程零路径手输（原则 1）；文案走 STR。
import { useRef, useState } from "react";
import { Atom, BarChart3, ClipboardList, FolderPlus, LayoutTemplate, X } from "lucide-react";
import { STR } from "../strings";
import { ModalSurface } from "./ModalSurface";

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

/** 单选组键盘目标：方向键循环，Home/End 到首尾；其他键留给控件本身。 */
export function templateNavigationTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  const at = current >= 0 && current < count ? current : 0;
  if (key === "ArrowRight" || key === "ArrowDown") return (at + 1) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (at - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** 名字实时校验（纯判据内联；返回错误文案或 null）。 */
export function validateProjectName(name: string, existingNames: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return STR.newProject.nameEmpty;
  if (/[\\/\u0000-\u001f]/.test(trimmed)) return STR.newProject.nameInvalid;
  if (existingNames.includes(trimmed)) return STR.newProject.nameTaken;
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
  return (
    <div className="modal-backdrop" role="presentation" onClick={props.onClose}>
      <ModalSurface
        className="modal-card modal-wide"
        label={STR.newProject.title}
        onClose={props.onClose}
        initialFocusRef={nameInput}
        onClick={(e) => { e.stopPropagation(); }}
      >
        <div className="modal-head">
          <span>{STR.newProject.title}</span>
          <button className="iconbtn sm" aria-label={STR.common.cancel} title={STR.common.cancel} onClick={props.onClose}>
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
                onClick={() => { setTemplateId(t.id); }}
                onKeyDown={(e) => {
                  const current = props.templates.findIndex((template) => template.id === templateId);
                  const next = templateNavigationTarget(e.key, current, props.templates.length);
                  if (next === null) return;
                  const target = props.templates[next];
                  if (target === undefined) return;
                  e.preventDefault();
                  setTemplateId(target.id);
                  e.currentTarget.parentElement
                    ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                    [next]?.focus();
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
            onChange={(e) => { setName(e.target.value); setError(null); }}
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
              onClick={() => {
                void props.onPickDirectory().then((picked) => { if (picked !== null) setParentDir(picked); });
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
          <button className="mini-btn" title={STR.common.cancel} onClick={props.onClose}>{STR.common.cancel}</button>
          <button
            className="mini-btn primary"
            title={STR.newProject.title}
            disabled={busy || nameError !== null || templateId === ""}
            onClick={() => {
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
            }}
          >
            {busy ? STR.common.creating : STR.common.create}
          </button>
        </div>
      </ModalSurface>
    </div>
  );
}
