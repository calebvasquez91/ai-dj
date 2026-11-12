/**
 * Which free-catalog tracks this app may play. Pure, so the rules can be tested.
 *
 * The engine remixes: it morphs a track's tempo and pitch, crossfades it into another and layers FX over it. So a
 * license is usable only when it allows adaptation, and the app is a product, so it must allow commercial use too.
 *   - CC0 and the Public Domain Mark: no conditions.
 *   - CC BY: usable, with credit (see attribution.ts).
 *   - CC BY-SA: off by default (the share-alike condition on a remix is unsettled for a mix like this); a policy flag
 *     turns it on once that has been decided.
 *   - Anything NonCommercial or NoDerivatives: never. An unreadable or missing license: never.
 * Not legal advice: have a music-licensing lawyer look at this before any public launch.
 */

export type LicenseCode = "cc0" | "pdm" | "by" | "by-sa" | "by-nc" | "by-nd" | "by-nc-sa" | "by-nc-nd";

export interface CatalogLicense {
  code: LicenseCode;
  /** For display: "CC BY 4.0", "CC0 1.0", "Public Domain Mark 1.0". */
  label: string;
  /** The license's canonical https URL (the jurisdiction part of a ported license's URL is dropped). */
  url: string;
  version: string;
  requiresAttribution: boolean;
  nonCommercial: boolean;
  noDerivatives: boolean;
  shareAlike: boolean;
}

export interface LicensePolicy {
  /** Accept CC BY-SA tracks. Off until the share-alike question has been settled. */
  allowShareAlike: boolean;
}

export const DEFAULT_LICENSE_POLICY: LicensePolicy = { allowShareAlike: false };

/** Why a track is left out; null from `licenseRejection` means it is usable. */
export type LicenseRejection = "unknown" | "non-commercial" | "no-derivatives" | "share-alike";

const CC_URL = /^https?:\/\/(?:www\.)?creativecommons\.org\/(licenses|publicdomain)\/([a-z0-9-]+)\/(\d+(?:\.\d+)?)(?:[/?#]|$)/i;

const LICENSE_SLUGS: Record<string, LicenseCode> = {
  by: "by",
  "by-sa": "by-sa",
  "by-nc": "by-nc",
  "by-nd": "by-nd",
  "by-nc-sa": "by-nc-sa",
  "by-nc-nd": "by-nc-nd",
};

/** Reads a Creative Commons license URL (http or https, with or without a deed/jurisdiction suffix). Null when it isn't one we know. */
export function parseLicenseUrl(url: string | null | undefined): CatalogLicense | null {
  if (!url) return null;
  const match = CC_URL.exec(url.trim());
  if (!match) return null;
  const kind = match[1].toLowerCase();
  const slug = match[2].toLowerCase();
  const version = match[3];

  let code: LicenseCode | undefined;
  if (kind === "publicdomain") {
    if (slug === "zero") code = "cc0";
    else if (slug === "mark") code = "pdm";
  } else {
    code = LICENSE_SLUGS[slug];
  }
  if (!code) return null;

  const isPublicDomain = code === "cc0" || code === "pdm";
  const label =
    code === "cc0" ? `CC0 ${version}` : code === "pdm" ? `Public Domain Mark ${version}` : `CC ${code.toUpperCase()} ${version}`;
  return {
    code,
    label,
    url: `https://creativecommons.org/${kind}/${slug}/${version}/`,
    version,
    requiresAttribution: !isPublicDomain,
    nonCommercial: code.includes("nc"),
    noDerivatives: code.includes("nd"),
    shareAlike: code.endsWith("sa"),
  };
}

/** Why this license rules a track out, or null when the track may be played. */
export function licenseRejection(
  license: CatalogLicense | null,
  policy: LicensePolicy = DEFAULT_LICENSE_POLICY
): LicenseRejection | null {
  if (!license) return "unknown";
  if (license.nonCommercial) return "non-commercial";
  if (license.noDerivatives) return "no-derivatives";
  if (license.shareAlike && !policy.allowShareAlike) return "share-alike";
  return null;
}

export function licenseAllowed(license: CatalogLicense | null, policy: LicensePolicy = DEFAULT_LICENSE_POLICY): boolean {
  return licenseRejection(license, policy) === null;
}
