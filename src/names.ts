// Nicknames are a display label. Scores, edits, and sign-in still use the roster name.
export function shownName(name: string, nicknames: Record<string, string>): string {
  const nick = nicknames[name]?.trim();
  return nick || name;
}

// The picker is a native select, so the signed-in person is marked in the option text.
export function pickerName(name: string, nicknames: Record<string, string>, isYou: boolean): string {
  const label = shownName(name, nicknames);
  return isYou ? `${label} (you)` : label;
}
