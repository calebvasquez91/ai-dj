/**
 * Small line-icon set (Spotify/Apple Music/YouTube Music-style, not emoji)
 * for the controls that render on nearly every screen — PlayerBar's
 * transport, panel toggles, and Sidebar's nav. `currentColor` throughout so
 * each call site's existing text-color / hover-color classes keep working
 * unchanged; only `size` is a prop, everything else is a fixed 24x24
 * viewBox so strokes stay crisp at the small sizes these render at.
 */
type IconProps = { size?: number; className?: string };

function base(size: number) {
  return { width: size, height: size, viewBox: "0 0 24 24", fill: "none" } as const;
}

export function PlayIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M7 4.5v15l13-7.5-13-7.5Z" fill="currentColor" />
    </svg>
  );
}

export function PauseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor" />
      <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" fill="currentColor" />
    </svg>
  );
}

export function PreviousIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M6 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M19 6 9 12l10 6V6Z" fill="currentColor" />
    </svg>
  );
}

export function NextIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M18 5v14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M5 6l10 6-10 6V6Z" fill="currentColor" />
    </svg>
  );
}

export function MicIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M12 17.5V21M9 21h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function DecksIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <circle cx="7" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="12" r="4.2" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="7" cy="12" r="1" fill="currentColor" />
      <circle cx="17" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

export function MixerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M5 21V10M12 21V3M19 21v-7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <circle cx="5" cy="13.5" r="2" fill="currentColor" />
      <circle cx="12" cy="7" r="2" fill="currentColor" />
      <circle cx="19" cy="17" r="2" fill="currentColor" />
    </svg>
  );
}

export function QueueIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 6h12M4 12h12M4 18h8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M18 9v9M15.5 15.5 18 18l2.5-2.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HomeIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M4 11.5 12 4l8 7.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 19v-5h4v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function LibraryIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <rect x="3.5" y="4" width="4" height="16" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <rect x="10" y="4" width="4" height="16" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M17.2 4.6 20.5 19.2l-3.9.9L13.3 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M5 8.5 12 15l7-6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon({ size = 16, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function SparklesIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} aria-hidden="true">
      <path d="M12 3.5 13.6 9l5.4 1.6-5.4 1.6L12 17.7 10.4 12.2 5 10.6 10.4 9 12 3.5Z" fill="currentColor" />
      <path d="M18.5 15.5 19.3 18l2.5.8-2.5.8-.8 2.4-.8-2.4-2.5-.8 2.5-.8.8-2.5Z" fill="currentColor" />
    </svg>
  );
}
