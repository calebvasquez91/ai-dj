/**
 * Que, the AI DJ's mascot (the little face with the speech bubble and the Halloween costumes), is switched off for now.
 * Everything that makes him lives in this folder (the component, the costumes, the dock above the player bar, his CSS in
 * que.css); nothing outside it may use him except behind this flag, which que.test.ts enforces. To bring him back, set
 * this to true: he returns to the Now Playing sheet and to the dock above the player bar.
 */
export const QUE_ENABLED = false;
