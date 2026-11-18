// Sidebar encouragement under "This week" on My week.
// Never prints "Down X from last week" while a week is still in progress:
// until someone matches or passes last week's score, it shows an Awesome Inc
// Core Value or Culture Book Rule instead.

export const AWESOME_INC_CUES = [
  "Core Value #1: Be Good — Serve others.",
  "Core Value #2: Be Excellent — Execute.",
  "Core Value #3: Be a Friend — Bring the fun.",
  "Core Value #4: Be You — Do your thing.",
  "Rule #4: Always do something awesome over something not awesome.",
  "Rule #17: Bring the fun.",
  "Rule #22: Go big or don’t be my friend.",
  "Rule #26: Don’t let stupid things keep you from doing awesome things.",
  "Rule #41: Do what you say you’re going to do and do it fast.",
  "Rule #76: No excuses, play like a champion.",
] as const;

export type WeekCue = {
  text: string;
  tone: "up" | "cue";
};

function hashSeed(seed: string): number {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return hash;
}

export function weekEncouragement({
  total,
  priorExists,
  priorPoints,
  selectedWeek,
  personKey,
}: {
  total: number;
  priorExists: boolean;
  priorPoints: number;
  selectedWeek: string;
  personKey: string;
}): WeekCue {
  if (priorExists && total > priorPoints) {
    return { text: `Up ${total - priorPoints} from last week`, tone: "up" };
  }
  if (priorExists && total === priorPoints && total > 0) {
    return { text: "Matched last week", tone: "up" };
  }
  const index = hashSeed(`${selectedWeek}|${personKey}`) % AWESOME_INC_CUES.length;
  return { text: AWESOME_INC_CUES[index], tone: "cue" };
}
