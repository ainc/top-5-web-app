// Nicknames are a display label. Scores, edits, and sign-in still use the roster name.
export function shownName(name: string, nicknames: Record<string, string>): string {
  const nick = nicknames[name]?.trim();
  return nick || name;
}
