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
        className="rounded-md shrink-0 border-2 border-border bg-gradient-to-br from-accent-teal via-accent-purple to-accent-pink flex items-center justify-center text-white"
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
      className="rounded-md shrink-0 object-cover border-2 border-border"
    />
  );
}
