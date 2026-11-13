import { afterEach, describe, expect, it, vi } from "vitest";
import { MAIL_TOTAL_TIMEOUT_MS, getMailConfig, sendFeedbackMail, type MailTransport } from "@/lib/mailer";
import type { FeedbackEmail } from "@/lib/feedback";

const email: FeedbackEmail = { subject: "AI DJ feedback: 4/5", text: "text", html: "<p>html</p>", replyTo: "sam@example.com" };
const config = { user: "me@gmail.com", pass: "abcdefghijklmnop", to: "me@gmail.com" };

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getMailConfig", () => {
  it("needs both the Gmail address and its App Password", () => {
    expect(getMailConfig({})).toBeNull();
    expect(getMailConfig({ GMAIL_USER: "me@gmail.com" })).toBeNull();
    expect(getMailConfig({ GMAIL_APP_PASSWORD: "abcd" })).toBeNull();
    expect(getMailConfig({ GMAIL_USER: "  ", GMAIL_APP_PASSWORD: "abcd" })).toBeNull();
  });

  it("ignores the spaces Google shows in an App Password, and sends to the sender unless told otherwise", () => {
    expect(getMailConfig({ GMAIL_USER: "me@gmail.com", GMAIL_APP_PASSWORD: "abcd efgh ijkl mnop" })).toEqual({
      user: "me@gmail.com",
      pass: "abcdefghijklmnop",
      to: "me@gmail.com",
    });
    expect(getMailConfig({ GMAIL_USER: "me@gmail.com", GMAIL_APP_PASSWORD: "abcd", FEEDBACK_TO_EMAIL: " inbox@example.com " })?.to).toBe("inbox@example.com");
  });
});

describe("sendFeedbackMail", () => {
  it("sends the message from the configured address to the owner, replying to the person", async () => {
    const sendMail = vi.fn(async () => ({}));
    const transport: MailTransport = { sendMail };
    expect(await sendFeedbackMail(email, { config, transport })).toBe(true);
    expect(sendMail).toHaveBeenCalledWith({
      from: '"AI DJ feedback" <me@gmail.com>',
      to: "me@gmail.com",
      replyTo: "sam@example.com",
      subject: "AI DJ feedback: 4/5",
      text: "text",
      html: "<p>html</p>",
    });
  });

  it("leaves out Reply-To when the person has no usable address", async () => {
    const sendMail = vi.fn(async () => ({}));
    await sendFeedbackMail({ ...email, replyTo: null }, { config, transport: { sendMail } });
    expect((sendMail.mock.calls[0] as unknown[])[0]).toMatchObject({ replyTo: undefined });
  });

  it("does nothing, and says so, when mail isn't set up", async () => {
    const sendMail = vi.fn();
    expect(await sendFeedbackMail(email, { config: null, transport: { sendMail } })).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it("reports a failed send as false, never throwing, logging only the error codes and never the message or the App Password", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failure = Object.assign(new Error(`Invalid login: 535 5.7.8 AUTH ${Buffer.from("\0me@gmail.com\0abcdefghijklmnop").toString("base64")} abcdefghijklmnop abcdefghijklmnop`), {
      code: "EAUTH",
      responseCode: 535,
    });
    const transport: MailTransport = {
      sendMail: async () => {
        throw failure;
      },
    };
    expect(await sendFeedbackMail(email, { config, transport })).toBe(false);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("EAUTH");
    expect(logged).toContain("535");
    expect(logged).not.toContain("abcdefghijklmnop");
    expect(logged).not.toContain(Buffer.from("\0me@gmail.com\0abcdefghijklmnop").toString("base64"));
    expect(logged).not.toContain("Invalid login");
  });

  it("copes with an error that has no code at all", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await sendFeedbackMail(email, { config, transport: { sendMail: async () => Promise.reject("nope") } })).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).toContain("unknown error");
  });

  it("gives up on a send that never finishes", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const pending = sendFeedbackMail(email, { config, transport: { sendMail: () => new Promise(() => {}) } });
    await vi.advanceTimersByTimeAsync(MAIL_TOTAL_TIMEOUT_MS + 1);
    expect(await pending).toBe(false);
  });
});
