"use client";

/**
 * Que's Halloween costumes — six hand-drawn SVG characters in the same flat,
 * glowing-LED style as the default helmet-robot Que (see Que.tsx), swapped in
 * while the Spooky Music playlist is active. Each one keeps Que's identity
 * (over-ear headphone cups) and plugs into the same animation hooks the
 * default face uses: `.que-body` bobs/bounces with the beat, `.que-eye`
 * blinks, and `talking` swaps the mouth to an "open" frame while the why-pill
 * is up. Drawn in the same 84×84 viewBox as the default so every animation's
 * transform-origin keeps working unchanged.
 */

export type HalloweenFace = "pumpkin" | "skull" | "ghost" | "bat" | "spider" | "cat";

export const HALLOWEEN_FACES: readonly HalloweenFace[] = ["pumpkin", "skull", "ghost", "bat", "spider", "cat"];

export const HALLOWEEN_FACE_LABELS: Record<HalloweenFace, string> = {
  pumpkin: "jack-o'-lantern",
  skull: "skull",
  ghost: "ghost",
  bat: "bat",
  spider: "spider",
  cat: "black cat",
};

/** Over-ear cups, same positions as the default Que so the silhouette stays recognizable. */
function Headphones({ left, right }: { left: string; right: string }) {
  return (
    <g className="que-band">
      <circle cx="8.5" cy="45" r="8.5" fill="#241a33" />
      <circle cx="8.5" cy="45" r="8.5" fill="none" stroke={left} strokeWidth="1.8" />
      <circle cx="8.5" cy="45" r="3.4" fill="#180f26" />
      <circle cx="75.5" cy="45" r="8.5" fill="#241a33" />
      <circle cx="75.5" cy="45" r="8.5" fill="none" stroke={right} strokeWidth="1.8" />
      <circle cx="75.5" cy="45" r="3.4" fill="#180f26" />
    </g>
  );
}

function Pumpkin({ talking }: { talking: boolean }) {
  return (
    <>
      <Headphones left="#8b5cf6" right="#22c55e" />
      <g className="que-body">
        <path d="M41 17 C40 10 43 6 48 6 C48 10 46 14 45 18 Z" fill="#3f8f2a" />
        <path d="M45 15 Q54 8 60 13" stroke="#2f6f20" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <ellipse cx="25" cy="47" rx="17" ry="27" fill="#e8590c" />
        <ellipse cx="59" cy="47" rx="17" ry="27" fill="#e8590c" />
        <ellipse cx="42" cy="47" rx="19" ry="29" fill="#ff7a1a" />
        <path d="M31 21 Q23 47 31 73" stroke="#c2410c" strokeWidth="1.6" fill="none" opacity="0.55" />
        <path d="M53 21 Q61 47 53 73" stroke="#c2410c" strokeWidth="1.6" fill="none" opacity="0.55" />
        <ellipse cx="30" cy="30" rx="9" ry="5" fill="#fff" opacity="0.14" />
        <g className="que-eye que-glow-yellow" style={{ transformOrigin: "31px 42px" }}>
          <path d="M24 47 L31 33 L38 47 Z" fill="#ffe14d" />
        </g>
        <g className="que-eye que-glow-yellow" style={{ transformOrigin: "53px 42px" }}>
          <path d="M46 47 L53 33 L60 47 Z" fill="#ffe14d" />
        </g>
        <path className="que-glow-yellow" d="M42 49 L38 56 L46 56 Z" fill="#ffe14d" />
        <path
          className="que-glow-yellow"
          d={
            talking
              ? "M26 59 L31 69 L36 62 L42 73 L48 62 L53 69 L58 59 Q42 82 26 59 Z"
              : "M27 59 L32 65 L37 60 L42 67 L47 60 L52 65 L57 59 Q42 74 27 59 Z"
          }
          fill="#ffe14d"
        />
      </g>
    </>
  );
}

function Skull({ talking }: { talking: boolean }) {
  return (
    <>
      <Headphones left="#f97316" right="#8b5cf6" />
      <g className="que-body">
        <path
          d="M14 42 C14 23 26 13 42 13 C58 13 70 23 70 42 C70 52 66 57 60 60 L60 66 Q60 70 56 70 L28 70 Q24 70 24 66 L24 60 C18 57 14 52 14 42 Z"
          fill="#f1ece0"
        />
        <path d="M60 22 C67 28 70 35 70 42 C70 52 66 57 60 60 L60 66 Q60 70 56 70 L50 70 C58 60 62 40 60 22 Z" fill="#d8d0bd" opacity="0.7" />
        <path d="M44 14 L41 22 L45 27 L42 33" stroke="#b9b09a" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <g className="que-eye" style={{ transformOrigin: "30px 43px" }}>
          <ellipse cx="30" cy="43" rx="9.5" ry="10.5" fill="#1a0f24" />
          <circle className="que-glow-green" cx="30" cy="44" r="3.6" fill="#7dff4d" />
        </g>
        <g className="que-eye" style={{ transformOrigin: "54px 43px" }}>
          <ellipse cx="54" cy="43" rx="9.5" ry="10.5" fill="#1a0f24" />
          <circle className="que-glow-green" cx="54" cy="44" r="3.6" fill="#7dff4d" />
        </g>
        <path d="M42 51 L37.5 60 L46.5 60 Z" fill="#1a0f24" />
        <g transform={talking ? "translate(0 3.5)" : undefined}>
          <rect x="26" y="62" width="32" height="12" rx="3" fill="#f1ece0" />
          <rect x="26" y="62" width="32" height="12" rx="3" fill="none" stroke="#1a0f24" strokeWidth="1.6" />
          <path d="M34 62 V74 M42 62 V74 M50 62 V74" stroke="#1a0f24" strokeWidth="1.4" />
        </g>
      </g>
    </>
  );
}

function Ghost({ talking }: { talking: boolean }) {
  return (
    <>
      <Headphones left="#f97316" right="#ec4899" />
      <g className="que-body">
        <path
          d="M16 46 C16 26 27 13 42 13 C57 13 68 26 68 46 L68 72 Q63 66 58 72 Q53 79 48 72 Q42 66 37 72 Q32 79 26 72 Q21 66 16 72 Z"
          fill="#f7f4ff"
        />
        <path d="M58 20 C65 27 68 35 68 46 L68 72 Q63 66 58 72 C62 55 63 35 58 20 Z" fill="#d9d0f2" opacity="0.7" />
        <ellipse cx="25" cy="55" rx="5" ry="3.2" fill="#f9a8d4" opacity="0.6" />
        <ellipse cx="59" cy="55" rx="5" ry="3.2" fill="#f9a8d4" opacity="0.6" />
        <g className="que-eye" style={{ transformOrigin: "33px 43px" }}>
          <ellipse cx="33" cy="43" rx="5.2" ry="7.4" fill="#1b1230" />
          <circle cx="34.8" cy="40.5" r="1.7" fill="#fff" />
        </g>
        <g className="que-eye" style={{ transformOrigin: "51px 43px" }}>
          <ellipse cx="51" cy="43" rx="5.2" ry="7.4" fill="#1b1230" />
          <circle cx="52.8" cy="40.5" r="1.7" fill="#fff" />
        </g>
        <ellipse cx="42" cy={talking ? 60 : 58} rx={talking ? 6 : 4.2} ry={talking ? 8 : 4.6} fill="#1b1230" />
      </g>
    </>
  );
}

function Bat({ talking }: { talking: boolean }) {
  const wing = "M30 44 L5 26 Q8 36 3 44 Q11 44 13 52 Q19 46 27 53 Z";
  return (
    <>
      <g className="que-body">
        <path d={wing} fill="#4c1d95" />
        <path d={wing} fill="none" stroke="#6d28d9" strokeWidth="1" />
        <path d={wing} fill="#4c1d95" transform="translate(84 0) scale(-1 1)" />
        <path d={wing} fill="none" stroke="#6d28d9" strokeWidth="1" transform="translate(84 0) scale(-1 1)" />
        <path d="M26 38 L23 12 L40 28 Z" fill="#2e1065" />
        <path d="M58 38 L61 12 L44 28 Z" fill="#2e1065" />
        <path d="M27 33 L25.5 20 L35 29 Z" fill="#f472b6" opacity="0.85" />
        <path d="M57 33 L58.5 20 L49 29 Z" fill="#f472b6" opacity="0.85" />
        <ellipse cx="42" cy="49" rx="21" ry="22" fill="#2e1065" />
        <ellipse cx="42" cy="40" rx="13" ry="6" fill="#fff" opacity="0.08" />
        <g className="que-eye que-glow-red" style={{ transformOrigin: "33px 46px" }}>
          <circle cx="33" cy="46" r="5.4" fill="#ff3b3b" />
          <circle cx="33.6" cy="45.4" r="1.9" fill="#ffd1d1" />
        </g>
        <g className="que-eye que-glow-red" style={{ transformOrigin: "51px 46px" }}>
          <circle cx="51" cy="46" r="5.4" fill="#ff3b3b" />
          <circle cx="51.6" cy="45.4" r="1.9" fill="#ffd1d1" />
        </g>
        <ellipse cx="42" cy="54" rx="2.4" ry="1.7" fill="#1a0f24" />
        {talking ? (
          <path d="M34 60 Q42 72 50 60 Z" fill="#1a0f24" />
        ) : (
          <path d="M34 60 Q42 65 50 60" stroke="#1a0f24" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        )}
        <path d="M36 61 L38 68 L40.5 61 Z" fill="#fff" />
        <path d="M43.5 61 L46 68 L48 61 Z" fill="#fff" />
      </g>
      <Headphones left="#f97316" right="#22c55e" />
    </>
  );
}

function Spider({ talking }: { talking: boolean }) {
  const leg = (d: string) => <path d={d} stroke="#2a1646" strokeWidth="3.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />;
  return (
    <>
      <path d="M42 0 V26" stroke="#c4b5fd" strokeWidth="1" opacity="0.55" />
      <g className="que-body">
        {leg("M24 44 Q9 36 6 22")}
        {leg("M22 51 Q5 50 3 38")}
        {leg("M23 58 Q7 64 6 75")}
        {leg("M28 64 Q17 72 19 81")}
        {leg("M60 44 Q75 36 78 22")}
        {leg("M62 51 Q79 50 81 38")}
        {leg("M61 58 Q77 64 78 75")}
        {leg("M56 64 Q67 72 65 81")}
        <circle cx="42" cy="48" r="22" fill="#2a1646" />
        <ellipse cx="42" cy="36" rx="13" ry="6" fill="#fff" opacity="0.07" />
        <path d="M38.5 56 H45.5 L42 61 L45.5 66 H38.5 L42 61 Z" fill="#ef4444" opacity="0.9" />
        <g className="que-eye que-glow-red" style={{ transformOrigin: "34px 43px" }}>
          <circle cx="34" cy="43" r="5.2" fill="#ff3b3b" />
          <circle cx="35" cy="42" r="1.7" fill="#ffd1d1" />
        </g>
        <g className="que-eye que-glow-red" style={{ transformOrigin: "50px 43px" }}>
          <circle cx="50" cy="43" r="5.2" fill="#ff3b3b" />
          <circle cx="51" cy="42" r="1.7" fill="#ffd1d1" />
        </g>
        <g className="que-eye que-glow-red">
          <circle cx="37.5" cy="33" r="2.6" fill="#ff6b6b" />
          <circle cx="46.5" cy="33" r="2.6" fill="#ff6b6b" />
        </g>
        <path d={talking ? "M36 56 Q35 66 39 70 M48 56 Q49 66 45 70" : "M36 56 Q35 62 38 65 M48 56 Q49 62 46 65"} stroke="#f5f3ff" strokeWidth="2" fill="none" strokeLinecap="round" />
      </g>
      <Headphones left="#f97316" right="#8b5cf6" />
    </>
  );
}

function Cat({ talking }: { talking: boolean }) {
  return (
    <>
      <Headphones left="#f97316" right="#8b5cf6" />
      <g className="que-body">
        <path d="M17 46 L15 13 L37 28 Z" fill="#14101f" />
        <path d="M67 46 L69 13 L47 28 Z" fill="#14101f" />
        <path d="M20 38 L19.5 22 L31 30 Z" fill="#f472b6" opacity="0.9" />
        <path d="M64 38 L64.5 22 L53 30 Z" fill="#f472b6" opacity="0.9" />
        <ellipse cx="42" cy="51" rx="27" ry="24" fill="#14101f" />
        <ellipse cx="42" cy="51" rx="27" ry="24" fill="none" stroke="#6d28d9" strokeWidth="1" opacity="0.8" />
        <ellipse cx="33" cy="35" rx="9" ry="4" fill="#fff" opacity="0.07" />
        <g className="que-eye que-glow-yellow" style={{ transformOrigin: "31px 48px" }}>
          <ellipse cx="31" cy="48" rx="6.2" ry="7.6" fill="#fde047" />
          <ellipse cx="31" cy="48" rx="1.7" ry="6.2" fill="#14101f" />
        </g>
        <g className="que-eye que-glow-yellow" style={{ transformOrigin: "53px 48px" }}>
          <ellipse cx="53" cy="48" rx="6.2" ry="7.6" fill="#fde047" />
          <ellipse cx="53" cy="48" rx="1.7" ry="6.2" fill="#14101f" />
        </g>
        <path d="M39 57 H45 L42 61 Z" fill="#f472b6" />
        <path d="M42 61 Q38 66 34 63 M42 61 Q46 66 50 63" stroke="#f1f5f9" strokeWidth="1.4" fill="none" strokeLinecap="round" />
        {talking && <ellipse cx="42" cy="66" rx="3.6" ry="4" fill="#7f1d1d" />}
        <path d="M24 58 L10 55 M24 62 L10 63 M24 66 L12 71 M60 58 L74 55 M60 62 L74 63 M60 66 L72 71" stroke="#cbd5e1" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
      </g>
    </>
  );
}

/** One of Que's six Halloween costumes, rendered at `size`px. `talking` is the open-mouth frame of the same two-frame talk cycle the default face uses. */
export function HalloweenQue({ face, size, talking }: { face: HalloweenFace; size: number; talking: boolean }) {
  return (
    <svg
      viewBox="0 0 84 84"
      width={size}
      height={size}
      fill="none"
      role="img"
      aria-label={`Que, dressed up as a ${HALLOWEEN_FACE_LABELS[face]}`}
    >
      {face === "pumpkin" && <Pumpkin talking={talking} />}
      {face === "skull" && <Skull talking={talking} />}
      {face === "ghost" && <Ghost talking={talking} />}
      {face === "bat" && <Bat talking={talking} />}
      {face === "spider" && <Spider talking={talking} />}
      {face === "cat" && <Cat talking={talking} />}
    </svg>
  );
}
