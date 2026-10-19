// 模型服务未配置横幅（2026-10-18 对照 Claude 桌面端的黄色告警条）：空屏顶层一条可操作的提示，
// 而不是等用户写完任务、按下发送才在错误行里说「没有 key」。只在 providerOk === false 时出现；
// 未知（还在读）不出——不拿「不知道」冒充「坏了」。
import { AlertTriangle } from "lucide-react";

export function ProviderBanner(props: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <div className="home-banner" role="status">
      <AlertTriangle size={15} className="home-banner-ico" aria-hidden="true" />
      <div className="home-banner-text">
        <strong>模型服务还没配好</strong>
        <span>没找到可用的 API Key，现在发送会失败。去设置里选一家服务，或填一把 key。</span>
      </div>
      <button className="mini-btn" onClick={props.onOpenSettings}>去设置</button>
    </div>
  );
}
