import { describe, expect, it } from "vitest";
import {
  FEEDBACK_MAX_COMMENT,
  RATING_LABELS,
  escapeHtml,
  formatFeedbackEmail,
  parseFeedbackBody,
  singleLine,
  starString,
} from "@/lib/feedback";

describe("parseFeedbackBody", () => {
  it("accepts a rating alone, and a rating with a comment and page", () => {
    expect(parseFeedbackBody({ rating: 4 })).toEqual({ ok: true, value: { rating: 4, comment: "", page: null } });
    expect(parseFeedbackBody({ rating: 1, comment: "  Crossfades are great  ", page: "/library" })).toEqual({
      ok: true,
      value: { rating: 1, comment: "Crossfades are great", page: "/library" },
    });
  });

  it("accepts each star from 1 to 5 and nothing else", () => {
    for (const rating of [1, 2, 3, 4, 5]) expect(parseFeedbackBody({ rating }).ok).toBe(true);
    for (const rating of [0, 6, -1, 3.5, NaN, Infinity, "4", null, undefined, true, [4]]) {
      expect(parseFeedbackBody({ rating }).ok, String(rating)).toBe(false);
    }
  });

  it("says what is wrong in words a person can read", () => {
    const bad = parseFeedbackBody({ rating: 9 });
    expect(!bad.ok && bad.error).toMatch(/1 to 5 stars/);
  });

  it("rejects a body that isn't an object", () => {
    for (const body of [null, undefined, "5", 5, [5], true]) expect(parseFeedbackBody(body).ok).toBe(false);
  });

  it("caps the comment, treating an over-long one as an error rather than cutting it off silently", () => {
    expect(parseFeedbackBody({ rating: 3, comment: "x".repeat(FEEDBACK_MAX_COMMENT) }).ok).toBe(true);
    expect(parseFeedbackBody({ rating: 3, comment: "x".repeat(FEEDBACK_MAX_COMMENT + 1) }).ok).toBe(false);
  });

  it("treats a missing or null comment as none, and a non-text comment as an error", () => {
    expect(parseFeedbackBody({ rating: 3, comment: null })).toEqual({ ok: true, value: { rating: 3, comment: "", page: null } });
    expect(parseFeedbackBody({ rating: 3, comment: 42 }).ok).toBe(false);
    expect(parseFeedbackBody({ rating: 3, comment: { a: 1 } }).ok).toBe(false);
  });

  it("strips control characters and normalises line endings, keeping newlines and tabs", () => {
    const result = parseFeedbackBody({ rating: 3, comment: "a\u0000b\u0007c\r\nline two\rline three\tend" });
    expect(result).toEqual({ ok: true, value: { rating: 3, comment: "abc\nline two\nline three\tend", page: null } });
  });

  it("keeps only a page that is a path inside the app", () => {
    const page = (p: unknown) => {
      const r = parseFeedbackBody({ rating: 3, page: p });
      return r.ok ? r.value.page : "ERR";
    };
    expect(page("/playlist?id=abc")).toBe("/playlist?id=abc");
    expect(page("https://evil.example/")).toBeNull();
    expect(page("library")).toBeNull();
    expect(page("/has space")).toBeNull();
    expect(page(`/${"x".repeat(250)}`)).toBeNull();
    expect(page(42)).toBeNull();
  });
});

describe("starString / RATING_LABELS", () => {
  it("draws filled and empty stars", () => {
    expect(starString(4)).toBe("★★★★☆");
    expect(starString(1)).toBe("★☆☆☆☆");
    expect(starString(5)).toBe("★★★★★");
    expect(starString(0)).toBe("☆☆☆☆☆");
    expect(starString(99)).toBe("★★★★★");
  });
  it("has a label for each count and none for no rating", () => {
    expect(RATING_LABELS[0]).toBe("");
    expect(RATING_LABELS.slice(1).every((l) => l.length > 0)).toBe(true);
    expect(RATING_LABELS).toHaveLength(6);
  });
});

describe("singleLine / escapeHtml", () => {
  it("flattens line breaks and control characters so a header can't be split", () => {
    expect(singleLine("a\r\nBcc: attacker@example.com\nb")).toBe("a Bcc: attacker@example.com b");
    expect(singleLine("x\u2028y\u2029z")).toBe("x y z");
    expect(singleLine("  a   b  ")).toBe("a b");
    expect(singleLine("x".repeat(500), 50)).toHaveLength(50);
  });
  it("escapes the five HTML characters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
});

describe("formatFeedbackEmail", () => {
  const base = {
    rating: 4,
    comment: "Love the crossfades.\nThe FX button is confusing.",
    userEmail: "sam@example.com",
    userName: "Sam",
    page: "/library",
    appVersion: "2.0.0",
    userAgent: "Mozilla/5.0 (Windows NT 10.0)",
    at: new Date("2026-11-12T12:00:00Z"),
  };

  it("puts the stars, the comment and who sent it in the text", () => {
    const mail = formatFeedbackEmail(base);
    expect(mail.subject).toBe("AI DJ feedback: ★★★★☆ 4/5 — Love the crossfades. The FX button is confusing.");
    expect(mail.text).toContain("4 out of 5");
    expect(mail.text).toContain("Love the crossfades.\nThe FX button is confusing.");
    expect(mail.text).toContain("From: Sam <sam@example.com>");
    expect(mail.text).toContain("Page: /library");
    expect(mail.text).toContain("App version: 2.0.0");
    expect(mail.text).toContain("Sent: 2026-11-12T12:00:00.000Z");
  });

  it("replies to the person's own address", () => {
    expect(formatFeedbackEmail(base).replyTo).toBe("sam@example.com");
    expect(formatFeedbackEmail({ ...base, userEmail: "not an email" }).replyTo).toBeNull();
    expect(formatFeedbackEmail({ ...base, userEmail: null }).replyTo).toBeNull();
    expect(formatFeedbackEmail({ ...base, userEmail: "a@b.co\r\nBcc: x@y.z" }).replyTo).toBeNull();
  });

  it("copes with a rating alone and with missing details", () => {
    const mail = formatFeedbackEmail({ rating: 2, comment: "", userEmail: null, userName: null, page: null, appVersion: null, userAgent: null, at: base.at });
    expect(mail.subject).toBe("AI DJ feedback: ★★☆☆☆ 2/5");
    expect(mail.text).toContain("(no comment)");
    expect(mail.text).toContain("From: Unknown user");
    expect(mail.text).toContain("Page: unknown");
  });

  it("shortens a long comment in the subject with an ellipsis and keeps it whole in the body", () => {
    const comment = "word ".repeat(60).trim();
    const mail = formatFeedbackEmail({ ...base, comment });
    expect(mail.subject.endsWith("…")).toBe(true);
    expect(mail.subject.length).toBeLessThan(150);
    expect(mail.text).toContain(comment);
  });

  it("never lets user text split the subject or inject markup", () => {
    const mail = formatFeedbackEmail({
      ...base,
      comment: "hi\r\nBcc: attacker@example.com\r\n\r\n<script>alert(1)</script>",
      userName: '"><img src=x onerror=alert(1)>',
      userAgent: "<b>UA</b>",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img");
    expect(mail.html).not.toContain("<b>UA</b>");
    expect(mail.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
