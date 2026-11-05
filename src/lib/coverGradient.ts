/**
 * The generated cover for a track or playlist with no artwork: a quiet two-stop gradient picked from a fixed set by a hash
 * of its title, so the same item always gets the same cover and a list of them doesn't look like one block of color.
 * The set is built from the app's own accents (violet, sky, rose, green), dimmed so a title laid over it stays readable.
 */
const STOPS: readonly (readonly [string, string])[] = [
  ["#5b4a9e", "#1f6f9a"], // violet to sky
  ["#9e3f58", "#5b4a9e"], // rose to violet
  ["#1f6f9a", "#2f8f63"], // sky to green
  ["#2f8f63", "#1f6f9a"], // green to sky
  ["#7a3f9e", "#9e3f58"], // purple to rose
  ["#3b4fa0", "#7a3f9e"], // indigo to purple
  ["#1f7f86", "#3b4fa0"], // teal to indigo
  ["#9e5a3f", "#9e3f58"], // amber to rose
];

/** A stable, non-negative hash of a string (FNV-1a). */
export function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** The CSS background for a cover made from `seed` (a title, a playlist name, an id). */
export function coverGradient(seed: string): string {
  const [from, to] = STOPS[hashSeed(seed.trim().toLowerCase()) % STOPS.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** The letter shown on a generated cover: the first letter or digit of the seed, uppercased, or a music note. */
export function coverInitial(seed: string): string {
  const match = seed.match(/[\p{L}\p{N}]/u);
  return match ? match[0].toUpperCase() : "\u266A";
}
