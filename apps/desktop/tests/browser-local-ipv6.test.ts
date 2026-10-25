import { describe, expect, it } from 'vitest';
import { hostAllowed } from '../src/main/browser-host';
import { sitePermissionFor } from '../src/renderer/components/panes';

describe('浏览器 IPv6 本地预览', () => {
  it('URL 标准解析得到带括号的 hostname，主进程与地址栏都视为本地', () => {
    const url = 'http://[::1]:5173/preview';
    expect(new URL(url).hostname).toBe('[::1]');
    expect(sitePermissionFor(url, new Set())).toBe('local');
    expect(hostAllowed(url, new Set())).toBe(true);
  });
  it('IPv4 映射地址与外站仍需显式授权', () => {
    expect(hostAllowed('http://[::ffff:127.0.0.1]:5173/', new Set())).toBe(false);
    expect(hostAllowed('https://outside.example/', new Set())).toBe(false);
  });
  it('本地主机名不放行非网页协议', () => {
    expect(hostAllowed('file://[::1]/private', new Set())).toBe(false);
    expect(hostAllowed('ftp://[::1]/private', new Set())).toBe(false);
  });
});
