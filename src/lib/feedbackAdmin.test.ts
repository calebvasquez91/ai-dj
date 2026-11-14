import { describe, expect, it } from "vitest";
import { isFeedbackAdmin, parseAdminEmails } from "@/lib/feedbackAdmin";

describe("parseAdminEmails", () => {
  it("splits on commas, trims, lower-cases and drops empty entries", () => {
    expect(parseAdminEmails(" Owner@Example.com ,second@example.com,, ")).toEqual(["owner@example.com", "second@example.com"]);
  });
  it("is empty for nothing", () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails(null)).toEqual([]);
    expect(parseAdminEmails("")).toEqual([]);
    expect(parseAdminEmails(" , ,")).toEqual([]);
  });
});

describe("isFeedbackAdmin", () => {
  const env = { FEEDBACK_ADMIN_EMAILS: "Owner@Example.com, second@example.com" };

  it("is true for a listed address, whatever its case or surrounding space", () => {
    expect(isFeedbackAdmin("owner@example.com", env)).toBe(true);
    expect(isFeedbackAdmin("  OWNER@EXAMPLE.COM ", env)).toBe(true);
    expect(isFeedbackAdmin("second@example.com", env)).toBe(true);
  });

  it("is false for anyone else, and never by substring or look-alike", () => {
    for (const email of ["other@example.com", "owner@example.com.evil.net", "xowner@example.com", "owner@example.co", "owner", "example.com"]) {
      expect(isFeedbackAdmin(email, env), email).toBe(false);
    }
  });

  it("is false for a missing address", () => {
    expect(isFeedbackAdmin(null, env)).toBe(false);
    expect(isFeedbackAdmin(undefined, env)).toBe(false);
    expect(isFeedbackAdmin("", env)).toBe(false);
  });

  it("is false for everyone when no admin is configured", () => {
    expect(isFeedbackAdmin("owner@example.com", {})).toBe(false);
    expect(isFeedbackAdmin("owner@example.com", { FEEDBACK_ADMIN_EMAILS: "" })).toBe(false);
    expect(isFeedbackAdmin("", { FEEDBACK_ADMIN_EMAILS: "," })).toBe(false);
  });

  it("is not granted by the notification settings", () => {
    expect(isFeedbackAdmin("me@gmail.com", { GMAIL_USER: "me@gmail.com", FEEDBACK_TO_EMAIL: "me@gmail.com" })).toBe(false);
  });
});
