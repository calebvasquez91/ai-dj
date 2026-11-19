"use client";

import { useState } from "react";
import { genreGradient, genreImage } from "@/lib/genreArt";

/**
 * A genre's cover: its registered photo (lib/genreArt.ts) when it has one, otherwise a generated gradient. A photo that fails to
 * load falls back to the gradient, so a card is never blank. Fills its parent.
 */
export function GenreCover({ genre }: { genre: string }) {
  const image = genreImage(genre);
  const [failed, setFailed] = useState(false);
  const gradient = genreGradient(genre);
  return (
    <span className="relative block h-full w-full" style={{ background: gradient.css }}>
      {image && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- a small local cover; the gradient is the fallback if it fails
        <img src={image.src} alt="" loading="lazy" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
      )}
    </span>
  );
}
