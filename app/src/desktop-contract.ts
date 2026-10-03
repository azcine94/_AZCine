export interface DesktopReport {
  requestId: number;
  appVersion: string;
  sqliteVersion: string;
  storage: 'temporary';
  roundTrip: true;
  rollback: true;
}

export type CheckState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; report: DesktopReport }
  | { status: 'error'; message: string };

export function parseDesktopReport(value: unknown, requestId: number): DesktopReport {
  if (!value || typeof value !== 'object') throw new Error('桌面返回的检查结果格式不正确。');
  const report = value as Record<string, unknown>;
  if (report.requestId !== requestId || report.storage !== 'temporary' || report.roundTrip !== true || report.rollback !== true || typeof report.appVersion !== 'string' || !report.appVersion || typeof report.sqliteVersion !== 'string' || !report.sqliteVersion) {
    throw new Error('桌面检查未完整通过，或返回了其他请求的结果。');
  }
  return report as unknown as DesktopReport;
}

export function desktopError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message;
  return '无法完成桌面连接检查。请重新启动开发窗口后重试。';
}
