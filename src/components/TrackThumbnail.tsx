import Image from "next/image";
import { CoverArt } from "@/ui";

export function TrackThumbnail({
  thumbnailUrl,
  title,
  size,
}: {
  thumbnailUrl?: string;
  title: string;
  size: number;
}) {
  // No artwork (a local file has none): the generated cover, a stable gradient with the title's first letter.
  if (!thumbnailUrl) return <CoverArt title={title} size={size} className="shadow-elevate-sm" />;
  return (
    <Image
      src={thumbnailUrl}
      alt={title}
      width={size}
      height={size}
      className="rounded-lg shrink-0 object-cover shadow-elevate-sm"
    />
  );
}
