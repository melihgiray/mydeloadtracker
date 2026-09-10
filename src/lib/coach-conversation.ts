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
  const history: CoachConversationMessage[] = [];
  for (const message of messages) {
    if (message.role === "assistant" && (message.error || !message.content.trim())) {
      // The immediately preceding user turn was never answered. Keeping it
      // would make the next request ask two questions while the UI shows one.
      if (history[history.length - 1]?.role === "user") history.pop();
      continue;
    }
    if (!message.content.trim()) continue;
    history.push(message);
  }
  return history;
}
