import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AgentEvent } from '../../../src/events';
import { Inspector } from '../src/renderer/components/Inspector';

function stat(html: string, label: string): string | undefined {
  return html.match(new RegExp(`<dt>${label}</dt><dd[^>]*>([^<]*)</dd>`))?.[1];
}
const conversation: AgentEvent[] = [
  { type: 'user_message', content: '检查界面' },
  { type: 'assistant_message', content: '完成' },
];
describe('概览中的未返回用量与实际零用量', () => {
  it('有消息但未收到 usage：输入输出显示未返回，仍展示已知的轮数', () => {
    const html = renderToStaticMarkup(<Inspector events={conversation} />);
    expect(stat(html, '输入')).toBe('未返回');
    expect(stat(html, '输出')).toBe('未返回');
    expect(stat(html, '对话轮数')).toBe('1');
    expect(stat(html, '用量次数')).toBe('0');
  });
  it('明确收到零用量：保留真实的 0', () => {
    const html = renderToStaticMarkup(<Inspector events={[...conversation, { type: 'usage', inputTokens: 0, outputTokens: 0 }]} />);
    expect(stat(html, '输入')).toBe('0');
    expect(stat(html, '输出')).toBe('0');
    expect(stat(html, '用量次数')).toBe('1');
  });
});
