import type { NextConfig } from "next";

// Runs as a real Next.js server now (Route Handlers, Prisma, auth) — hosted
// on Vercel at the domain root, so no more static export / basePath.
const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      // YouTube video thumbnails (TrackThumbnail.tsx renders these for imported tracks).
      { protocol: "https", hostname: "i.ytimg.com" },
    ],
  },
};

export default nextConfig;
