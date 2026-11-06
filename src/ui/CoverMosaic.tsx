import { mosaicTiles } from "@/lib/mosaic";
import { CoverArt } from "./CoverArt";

/**
 * The cover for a playlist or an artist: a 2 x 2 mosaic of its songs' covers when it has four or more, else its first
 * song's cover, else a generated one from `title`. Fills its parent (give the parent a size).
 */
export function CoverMosaic({ title, items }: { title: string; items: readonly { title: string; src?: string | null }[] }) {
  const tiles = mosaicTiles(items);
  if (tiles.length === 4) {
    return (
      <div className="grid h-full w-full grid-cols-2 grid-rows-2 gap-px overflow-hidden rounded-lg bg-surface-raised" role="img" aria-label={title}>
        {tiles.map((t, i) => (
          <CoverArt key={i} title={t.title} src={t.src} className="!rounded-none" />
        ))}
      </div>
    );
  }
  const first = tiles[0];
  return <CoverArt title={first ? first.title : title} src={first?.src} />;
}
