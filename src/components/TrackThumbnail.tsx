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
        className="rounded-lg shrink-0 shadow-elevate-sm bg-gradient-to-br from-accent-teal to-accent-purple flex items-center justify-center text-white"
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
      className="rounded-lg shrink-0 object-cover shadow-elevate-sm"
    />
  );
}
