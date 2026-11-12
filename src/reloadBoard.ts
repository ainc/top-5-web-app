// The scorecard reload. A save imports reload and calls it.
//
// BoardProvider subscribes and refetches the open weeks. AuthProvider
// subscribes and rereads the signed-in profile, so a nickname or a role
// shows up without a browser refresh. This file imports neither of them:
// board.tsx already imports auth.tsx, and a window event was the old way
// around that cycle. A misspelled reload is a type error. The old event
// name was a string, so a typo compiled and the week stayed stale.

type ReloadListener = () => void;

const listeners = new Set<ReloadListener>();

export function onReload(listener: ReloadListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reload(): void {
  for (const listener of [...listeners]) listener();
}
