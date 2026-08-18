import type { NextConfig } from "next";

// GitHub Pages serves this repo at /ai-dj/ (a project page, not a
// <user>.github.io root page), so static assets and routes need that
// prefix. GITHUB_PAGES is set only by the Pages deploy workflow — local
// dev and any other build stay at the site root.
const isGithubPages = process.env.GITHUB_PAGES === "true";
const repoName = "ai-dj";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  basePath: isGithubPages ? `/${repoName}` : "",
  assetPrefix: isGithubPages ? `/${repoName}/` : "",
};

export default nextConfig;
