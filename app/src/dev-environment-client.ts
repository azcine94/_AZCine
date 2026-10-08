import { invoke } from './desktop-api.ts';

export interface EnvironmentPaths { herdr: string; openpi: string; skills: string }
export interface EnvironmentSnapshot {
  paths: EnvironmentPaths;
  versions: { herdr: string; openpi: string; pi: string; node: string };
  dependencies: { node: string; git: string; powershell: string };
  issues: string[]; warnings: string[]; ready: boolean;
}
export interface EnvironmentJob {
  id: number; status: 'idle'|'running'|'cancelling'|'cancelled'|'failed'|'completed';
  message: string; done: number; total: number; output: string|null; files: string[];
}
export const idleEnvironmentJob: EnvironmentJob = { id: 0, status: 'idle', message: '', done: 0, total: 0, output: null, files: [] };
export const environmentClient = {
  inspect: (paths: EnvironmentPaths) => invoke<EnvironmentSnapshot>('dev_environment_inspect', { paths }),
  export: (paths: EnvironmentPaths, output: string) => invoke<EnvironmentJob>('dev_environment_export', { input: { paths, output } }),
  status: () => invoke<EnvironmentJob>('dev_environment_status'),
  cancel: () => invoke<EnvironmentJob>('dev_environment_cancel'),
  pick: () => invoke<string|null>('pick_data_root'),
  open: () => invoke<void>('dev_environment_open'),
};
