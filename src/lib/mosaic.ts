/**
 * The covers a playlist or artist shows: a 2 x 2 mosaic of four when it has at least four, otherwise just the first
 * one (a mosaic with gaps looks broken), or none (the caller shows a generated cover from the name).
 */
export function mosaicTiles<T>(items: readonly T[]): T[] {
  if (items.length >= 4) return items.slice(0, 4);
  return items.slice(0, 1);
}
