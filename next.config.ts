import type { NextConfig } from "next";
import { fileURLToPath } from "url";
import path from "path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

// Runs as a real Next.js server now (Route Handlers, Prisma, auth) — hosted
// on Vercel at the domain root, so no more static export / basePath.
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // YouTube video thumbnails (TrackThumbnail.tsx renders these for imported tracks).
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
  turbopack: {
    // A stray package-lock.json directly under the Windows user profile dir
    // (C:\Users\<user>), outside this repo entirely, makes Turbopack's
    // multi-lockfile root inference walk up past this project and pick that
    // as the workspace root instead — which silently resolves `src/` against
    // whichever checkout happens to match that wrong root (observed: a git
    // worktree of this repo serving the *main* checkout's source instead of
    // its own). Pinning root to this config file's own directory makes root
    // detection exact regardless of stray lockfiles elsewhere on the drive,
    // and self-corrects per checkout (worktree vs main) since it's derived,
    // not hardcoded.
    root: projectRoot,
  },
};

export default nextConfig;
