/**
 * "Word Play" — spoken DJ hype phrases via the browser's built-in
 * text-to-speech (SpeechSynthesis), since a real vocal-tag sample would
 * need a licensed audio asset this app doesn't have.
 *
 * Hard limitation worth knowing: SpeechSynthesis audio does not route
 * through the Web Audio graph — it plays on the system's default output
 * independently of masterGain, so it can't be volume-matched, ducked
 * under the music, or captured for effects the way every other transition
 * in this app is. It just speaks over whatever's already playing.
 */

export const HYPE_PHRASES = [
  "Let's go!",
  "Turn it up!",
  "Make some noise!",
  "Here we go!",
  "Keep it moving!",
  "Yeah!",
  "Coming up next!",
  "This is it!",
];

export function isWordPlaySupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Speaks a hype phrase (random from HYPE_PHRASES if none given). Returns false if the browser has no SpeechSynthesis support. */
export function speakHypePhrase(phrase?: string): boolean {
  if (!isWordPlaySupported()) return false;
  const text = phrase ?? HYPE_PHRASES[Math.floor(Math.random() * HYPE_PHRASES.length)];
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.pitch = 1.1;
  utterance.rate = 1.05;
  utterance.volume = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

export function cancelHypePhrase(): void {
  if (!isWordPlaySupported()) return;
  window.speechSynthesis.cancel();
}
