import { describe, expect, it } from "vitest";
import { isFeedbackAdmin, parseAdminIds } from "@/lib/feedbackAdmin";

describe("parseAdminIds", () => {
  it("splits on commas, trims and drops empty entries, leaving case alone (ids are case-sensitive)", () => {
    expect(parseAdminIds(" cmABC123 ,cmxyz789,, ")).toEqual(["cmABC123", "cmxyz789"]);
  });
  it("is empty for nothing", () => {
    expect(parseAdminIds(undefined)).toEqual([]);
    expect(parseAdminIds(null)).toEqual([]);
    expect(parseAdminIds("")).toEqual([]);
    expect(parseAdminIds(" , ,")).toEqual([]);
  });
});

describe("isFeedbackAdmin", () => {
  const env = { FEEDBACK_ADMIN_USER_IDS: "cmowner0001, cmsecond0002" };

  it("is true for a listed id, whatever surrounds it in the setting", () => {
    expect(isFeedbackAdmin("cmowner0001", env)).toBe(true);
    expect(isFeedbackAdmin("cmsecond0002", env)).toBe(true);
  });

  it("is false for anyone else, and never by substring, prefix or different case", () => {
    for (const id of ["cmother0003", "cmowner00", "cmowner00011", "CMOWNER0001", "xcmowner0001", "cmowner0001 ", "owner"]) {
      expect(isFeedbackAdmin(id, env), id).toBe(false);
    }
  });

  it("is false for a missing id", () => {
    expect(isFeedbackAdmin(null, env)).toBe(false);
    expect(isFeedbackAdmin(undefined, env)).toBe(false);
    expect(isFeedbackAdmin("", env)).toBe(false);
  });

  it("is false for everyone when no admin is configured", () => {
    expect(isFeedbackAdmin("cmowner0001", {})).toBe(false);
    expect(isFeedbackAdmin("cmowner0001", { FEEDBACK_ADMIN_USER_IDS: "" })).toBe(false);
    expect(isFeedbackAdmin("", { FEEDBACK_ADMIN_USER_IDS: "," })).toBe(false);
  });

  it("is not granted by an email, by the old email setting, or by the notification settings", () => {
    expect(isFeedbackAdmin("me@gmail.com", { FEEDBACK_ADMIN_USER_IDS: "me@gmail.com" })).toBe(true); // only because it was listed as an id: ids are opaque strings
    expect(isFeedbackAdmin("me@gmail.com", { FEEDBACK_ADMIN_EMAILS: "me@gmail.com" })).toBe(false);
    expect(isFeedbackAdmin("me@gmail.com", { GMAIL_USER: "me@gmail.com", FEEDBACK_TO_EMAIL: "me@gmail.com" })).toBe(false);
  });
});
