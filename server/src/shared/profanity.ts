// ============================================================================
// shared/profanity.ts — server-side profanity censor (obscenity)
//
// One matcher + censor pair, built once at module load. English dataset with
// the recommended transformers (catches leetspeak / spacing / repeated-char
// evasions). Asterisk strategy keeps output the SAME LENGTH as input, so the
// MAX_CHAT_LEN / MAX_NAME_LEN caps applied before censoring still hold after.
//
// Censor-don't-drop: a filtered message still goes through (as "f***"), so
// senders don't retry-spam a message that silently vanished.
// ============================================================================

import {
  RegExpMatcher,
  TextCensor,
  asteriskCensorStrategy,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

const matcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

const censor = new TextCensor().setStrategy(asteriskCensorStrategy());

export function censorProfanity(text: string): string {
  if (!text) return text;
  const matches = matcher.getAllMatches(text);
  if (matches.length === 0) return text;
  return censor.applyTo(text, matches);
}
