// The picture for a genre card ("Made by your DJ", the Genre screen). Every genre has a generated gradient, always available; a real photo is
// used only when one is registered below, so a card never requests an image that is not there. A photo that fails to load falls back to
// the gradient (components/GenreCover.tsx). Pure.
//
// Photos must be free to use (Unsplash, Pexels or Pixabay licence): register each one here with where it came from, and the About screen's
// Credits section lists it. Files live in public/genre-art/ and are served from the app itself.

export interface GenreImage {
  /** Path under /public, e.g. "/genre-art/hip-hop.jpg". */
  src: string;
  /** The photographer, as the source shows them. */
  credit: string;
  /** "Unsplash", "Pexels" or "Pixabay". */
  source: "Unsplash" | "Pexels" | "Pixabay";
  /** The photo's own page, which shows the licence. */
  url: string;
}

/** Photos by genre slug. Empty until images are added (and their licences checked); the gradients cover every genre meanwhile. */
export const GENRE_IMAGES: Readonly<Record<string, GenreImage>> = {};

export function genreSlug(genre: string): string {
  return genre
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function genreImage(genre: string, images: Readonly<Record<string, GenreImage>> = GENRE_IMAGES): GenreImage | null {
  return images[genreSlug(genre)] ?? null;
}

/** A stable number for a genre name (the same name always gets the same colours). */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * Two hues for the genre's gradient, from the same violet-to-cyan family the app uses (hue 170-300), so every card sits in the
 * theme; the genre decides where in that range. Returns CSS colours for a diagonal gradient.
 */
export function genreGradient(genre: string): { from: string; to: string; css: string } {
  const h = hash(genreSlug(genre) || genre);
  const hue = 170 + (h % 130);
  const from = `hsl(${hue} 70% 38%)`;
  const to = `hsl(${(hue + 55) % 360} 65% 24%)`;
  return { from, to, css: `linear-gradient(135deg, ${from}, ${to})` };
}

/** The photos that are registered, for the Credits section. */
export function genreCredits(images: Readonly<Record<string, GenreImage>> = GENRE_IMAGES): (GenreImage & { slug: string })[] {
  return Object.entries(images)
    .map(([slug, image]) => ({ slug, ...image }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
}
