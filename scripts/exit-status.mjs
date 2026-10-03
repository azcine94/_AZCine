// Shared by the launcher and its exit-code tests; interruption must never pass a test run.
export function childExitStatus({ mode, stopping, code, signal, failureCode = 0 }) {
  if (failureCode) return failureCode;
  if (stopping) return mode === 'dev' ? 0 : 130;
  return code ?? (signal ? 1 : 0);
}
