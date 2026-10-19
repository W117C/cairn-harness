// v12 导入诊断卡（ADR 0004 §4）：导入已有文件夹 / 克隆之后，先把这个目录的三态诊断摆上屏——
// 支持 / 需要补充信息 / 当前不支持（badge 用 ADR 原话），配判定依据与下一步。
// 非阻断：只提示，不拦着登记项目、不拦着开会话；点「知道了」才收。判定文案来自 main 侧同一事实源
//（project-templates.diagnoseProjectDirectory），渲染层不另编一套结论。
import { AlertTriangle, Check, Info, X } from "lucide-react";
import type { ProjectDiagnosis, ProjectDiagnosisVerdict } from "../../../../../src/main/ipc-protocol";
import { STR } from "../strings";

const VERDICT_LABEL: Record<ProjectDiagnosisVerdict, string> = {
  supported: STR.importDiagnosis.verdict.supported,
  "needs-info": STR.importDiagnosis.verdict.needsInfo,
  unsupported: STR.importDiagnosis.verdict.unsupported,
};

const VERDICT_TONE: Record<ProjectDiagnosisVerdict, string> = {
  supported: "is-ok",
  "needs-info": "is-warn",
  unsupported: "is-no",
};

export function ImportDiagnosisCard(props: { name: string; diagnosis: ProjectDiagnosis; onDismiss: () => void }) {
  const { diagnosis } = props;
  const tone = VERDICT_TONE[diagnosis.verdict];
  return (
    <div className={`diagnosis-card ${tone}`} role="status" aria-label={STR.importDiagnosis.aria} data-verdict={diagnosis.verdict}>
      <div className="diagnosis-head">
        <span className="diagnosis-badge">
          <span className="ico" aria-hidden="true">
            {diagnosis.verdict === "supported" ? <Check size={12} /> : diagnosis.verdict === "needs-info" ? <Info size={12} /> : <AlertTriangle size={12} />}
          </span>
          {VERDICT_LABEL[diagnosis.verdict]}
        </span>
        <span className="name">{props.name}</span>
        <span className="msg">{diagnosis.summary}</span>
        <button className="x" onClick={props.onDismiss} aria-label={STR.importDiagnosis.dismiss}>
          <X size={12} />
        </button>
      </div>
      {diagnosis.reasons.length > 0 && (
        <div className="diagnosis-row">
          <span className="tag">{STR.importDiagnosis.why}</span>
          <ul className="diagnosis-list">
            {diagnosis.reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}
      {diagnosis.hint !== undefined && (
        <div className="diagnosis-row">
          <span className="tag">{STR.importDiagnosis.next}</span>
          <span className="msg">{diagnosis.hint}</span>
        </div>
      )}
    </div>
  );
}
