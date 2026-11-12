import { describe, expect, it } from "vitest";
import { licenseAllowed, licenseRejection, parseLicenseUrl } from "@/lib/catalog/license";

describe("parseLicenseUrl", () => {
  it("reads every Creative Commons license by its flags", () => {
    const cases: [string, string, { nc: boolean; nd: boolean; sa: boolean; credit: boolean }][] = [
      ["https://creativecommons.org/licenses/by/4.0/", "by", { nc: false, nd: false, sa: false, credit: true }],
      ["https://creativecommons.org/licenses/by-sa/4.0/", "by-sa", { nc: false, nd: false, sa: true, credit: true }],
      ["https://creativecommons.org/licenses/by-nc/3.0/", "by-nc", { nc: true, nd: false, sa: false, credit: true }],
      ["https://creativecommons.org/licenses/by-nd/3.0/", "by-nd", { nc: false, nd: true, sa: false, credit: true }],
      ["https://creativecommons.org/licenses/by-nc-sa/3.0/", "by-nc-sa", { nc: true, nd: false, sa: true, credit: true }],
      ["https://creativecommons.org/licenses/by-nc-nd/3.0/", "by-nc-nd", { nc: true, nd: true, sa: false, credit: true }],
      ["https://creativecommons.org/publicdomain/zero/1.0/", "cc0", { nc: false, nd: false, sa: false, credit: false }],
      ["https://creativecommons.org/publicdomain/mark/1.0/", "pdm", { nc: false, nd: false, sa: false, credit: false }],
    ];
    for (const [url, code, flags] of cases) {
      const license = parseLicenseUrl(url);
      expect(license?.code, url).toBe(code);
      expect(license?.nonCommercial, url).toBe(flags.nc);
      expect(license?.noDerivatives, url).toBe(flags.nd);
      expect(license?.shareAlike, url).toBe(flags.sa);
      expect(license?.requiresAttribution, url).toBe(flags.credit);
    }
  });

  it("accepts http, www, deed pages, jurisdiction ports, query strings and any case", () => {
    expect(parseLicenseUrl("http://creativecommons.org/licenses/by-nc-sa/3.0/")?.code).toBe("by-nc-sa");
    expect(parseLicenseUrl("https://www.creativecommons.org/licenses/by/4.0/deed.en")?.code).toBe("by");
    expect(parseLicenseUrl("https://creativecommons.org/licenses/by/2.0/fr/")?.code).toBe("by");
    expect(parseLicenseUrl("https://creativecommons.org/licenses/by/4.0?ref=x")?.code).toBe("by");
    expect(parseLicenseUrl("HTTPS://CreativeCommons.org/Licenses/BY/4.0/")?.code).toBe("by");
    expect(parseLicenseUrl("  https://creativecommons.org/licenses/by/4.0/  ")?.code).toBe("by");
  });

  it("gives a canonical URL and a readable label", () => {
    const by = parseLicenseUrl("http://creativecommons.org/licenses/by/2.0/fr/deed.fr");
    expect(by?.url).toBe("https://creativecommons.org/licenses/by/2.0/");
    expect(by?.label).toBe("CC BY 2.0");
    expect(parseLicenseUrl("https://creativecommons.org/licenses/by-sa/4.0/")?.label).toBe("CC BY-SA 4.0");
    expect(parseLicenseUrl("https://creativecommons.org/publicdomain/zero/1.0/")?.label).toBe("CC0 1.0");
    expect(parseLicenseUrl("https://creativecommons.org/publicdomain/mark/1.0/")?.label).toBe("Public Domain Mark 1.0");
  });

  it("returns null for anything that is not a license URL it knows", () => {
    for (const bad of [
      undefined,
      null,
      "",
      "all rights reserved",
      "https://example.com/licenses/by/4.0/",
      "https://creativecommons.org/licenses/by-xx/4.0/",
      "https://creativecommons.org/licenses/zero/1.0/",
      "https://creativecommons.org/publicdomain/by/1.0/",
      "https://creativecommons.org/licenses/by/",
      "https://creativecommons.org.evil.com/licenses/by/4.0/",
      "https://evil.com/?u=https://creativecommons.org/licenses/by/4.0/",
    ]) {
      expect(parseLicenseUrl(bad), String(bad)).toBeNull();
    }
  });
});

describe("licenseRejection / licenseAllowed", () => {
  const license = (url: string) => parseLicenseUrl(url);

  it("allows CC0, the Public Domain Mark and CC BY", () => {
    for (const url of [
      "https://creativecommons.org/publicdomain/zero/1.0/",
      "https://creativecommons.org/publicdomain/mark/1.0/",
      "https://creativecommons.org/licenses/by/4.0/",
    ]) {
      expect(licenseRejection(license(url)), url).toBeNull();
      expect(licenseAllowed(license(url)), url).toBe(true);
    }
  });

  it("refuses NonCommercial and NoDerivatives licenses, with the reason", () => {
    expect(licenseRejection(license("https://creativecommons.org/licenses/by-nc/3.0/"))).toBe("non-commercial");
    expect(licenseRejection(license("https://creativecommons.org/licenses/by-nc-sa/3.0/"))).toBe("non-commercial");
    expect(licenseRejection(license("https://creativecommons.org/licenses/by-nc-nd/3.0/"))).toBe("non-commercial");
    expect(licenseRejection(license("https://creativecommons.org/licenses/by-nd/3.0/"))).toBe("no-derivatives");
  });

  it("refuses a missing or unreadable license", () => {
    expect(licenseRejection(null)).toBe("unknown");
    expect(licenseAllowed(parseLicenseUrl("nonsense"))).toBe(false);
  });

  it("keeps BY-SA out unless the policy opts in, and never lets the opt-in reach NC or ND", () => {
    const sa = license("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(licenseRejection(sa)).toBe("share-alike");
    expect(licenseAllowed(sa, { allowShareAlike: true })).toBe(true);
    expect(licenseAllowed(license("https://creativecommons.org/licenses/by-nc-sa/3.0/"), { allowShareAlike: true })).toBe(false);
    expect(licenseAllowed(license("https://creativecommons.org/licenses/by-nd/3.0/"), { allowShareAlike: true })).toBe(false);
  });
});
