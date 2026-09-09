export interface CoachConversationMessage {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

/**
 * Keep general coaching and each saved workout review in separate threads.
 * The general name deliberately preserves the original storage key.
 */
export function coachConversationName(selectedWorkoutId?: string | null): string {
  return selectedWorkoutId ? `coach.workout.${selectedWorkoutId}` : "coach";
}

/** Error copy belongs to the UI, not the coaching transcript. */
export function sendableCoachHistory(
  messages: CoachConversationMessage[],
): CoachConversationMessage[] {
  return messages.filter((message) => !message.error && message.content.trim().length > 0);
}
