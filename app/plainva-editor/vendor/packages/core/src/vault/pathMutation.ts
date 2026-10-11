/** One gate shared by the editor and sync worker that use the same vault state. */
const scopes = new WeakMap<object, Map<string, Promise<unknown>>>();

function lockKeys(paths: readonly string[]): string[] {
  const keys = new Set<string>();
  for (const path of paths) {
    const parts = path.replace(/\\/g, "/").normalize("NFC").toLowerCase().split("/").filter(part => part && part !== ".");
    // Ancestors protect directory moves/deletes against writes below them.
    for (let i = 1; i <= parts.length; i++) keys.add(parts.slice(0, i).join("/"));
  }
  return [...keys].sort();
}

/** Acquire the complete ordered set at once; never hold a gate over a download. */
export function withPathMutation<T>(scope: object, paths: readonly string[], action: () => Promise<T>): Promise<T> {
  let tails = scopes.get(scope);
  if (!tails) { tails = new Map(); scopes.set(scope, tails); }
  const keys = lockKeys(paths);
  const previous = [...new Set(keys.map(key => tails!.get(key)).filter((value): value is Promise<unknown> => !!value))];
  const next = Promise.all(previous.map(promise => promise.catch(() => undefined))).then(action);
  for (const key of keys) tails.set(key, next);
  void next.catch(() => undefined).then(() => {
    for (const key of keys) if (tails!.get(key) === next) tails!.delete(key);
  });
  return next;
}
