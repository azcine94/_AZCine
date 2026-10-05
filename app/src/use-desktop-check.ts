import { useRef, useState } from 'react';
import { invoke, isTauri } from './desktop-api.ts';
import { desktopError, parseDesktopReport } from './desktop-contract.ts';
import type { CheckState } from './desktop-contract.ts';

const CHECK_TIMEOUT_MS = 15_000;

export function useDesktopCheck() {
  const [state, setState] = useState<CheckState>({ status: 'idle' });
  const pending = useRef(false);
  const nextId = useRef(0);
  const connected = isTauri();

  async function check() {
    if (pending.current) return;
    if (!connected) {
      setState({ status: 'error', message: '当前只是网页预览，没有桌面连接。请从项目根运行 npm run dev。' });
      return;
    }
    pending.current = true;
    const requestId = nextId.current = nextId.current % 0xffff_fffe + 1;
    setState({ status: 'loading' });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        invoke<unknown>('check_desktop', { requestId }),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('桌面连接检查超时，未报告成功。请稍后重试。')), CHECK_TIMEOUT_MS);
        }),
      ]);
      setState({ status: 'success', report: parseDesktopReport(result, requestId) });
    } catch (error) {
      setState({ status: 'error', message: desktopError(error) });
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
      pending.current = false;
    }
  }
  return { state, check, connected };
}
