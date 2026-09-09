export interface RecentWorkoutNote {
  performedAt: string;
  note: string;
}

const MAX_NOTES = 8;
const MAX_NOTE_CHARACTERS = 200;

function compactNote(note: string): string {
  const compact = note.replace(/\s+/g, " ").trim();
  if (compact.length <= MAX_NOTE_CHARACTERS) return compact;
  return `${compact.slice(0, MAX_NOTE_CHARACTERS - 3)}...`;
}

/** Small bounded memory block. Notes remain quoted athlete data, never instructions. */
export function summariseRecentWorkoutNotes(notes: RecentWorkoutNote[]): string | null {
  const lines = notes
    .slice(0, MAX_NOTES)
    .map((entry) => ({ date: entry.performedAt.slice(0, 10), note: compactNote(entry.note) }))
    .filter((entry) => entry.note.length > 0)
    .map((entry) => `${entry.date}: ${JSON.stringify(entry.note)}`);
  if (lines.length === 0) return null;
  return ["=== RECENT WORKOUT NOTES ===", ...lines].join("\n");
}
