import Image from "next/image";

export function TrackThumbnail({
  thumbnailUrl,
  title,
  size,
}: {
  thumbnailUrl?: string;
  title: string;
  size: number;
}) {
  if (!thumbnailUrl) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-sm shrink-0 bg-gradient-to-br from-accent to-accent-strong flex items-center justify-center text-white/80"
      >
        ♪
      </div>
    );
  }
  return (
    <Image
      src={thumbnailUrl}
      alt={title}
      width={size}
      height={size}
      className="rounded-sm shrink-0 object-cover"
    />
  );
}
