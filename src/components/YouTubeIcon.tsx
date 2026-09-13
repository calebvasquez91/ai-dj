/** Small YouTube "play" glyph — the universally recognized brand mark, kept in its own real red regardless of app theme since it identifies an external service, not themed app chrome. */
export function YouTubeIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={(size * 20) / 28}
      viewBox="0 0 28 20"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect width="28" height="20" rx="6" fill="#FF0000" />
      <path d="M11.5 6.3 19.5 10l-8 3.7Z" fill="#fff" />
    </svg>
  );
}
