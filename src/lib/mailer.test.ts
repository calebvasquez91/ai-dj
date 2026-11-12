import { afterEach, describe, expect, it, vi } from "vitest";
import { getMailConfig, sendFeedbackMail, type MailTransport } from "@/lib/mailer";
import type { FeedbackEmail } from "@/lib/feedback";

const email: FeedbackEmail = { subject: "AI DJ feedback: 4/5", text: "text", html: "<p>html</p>", replyTo: "sam@example.com" };
const config = { user: "me@gmail.com", pass: "abcdefghijklmnop", to: "me@gmail.com" };

afterEach(() => vi.restoreAllMocks());

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

  it("reports a failed send as false, never throwing, and never logging the App Password", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const transport: MailTransport = {
      sendMail: async () => {
        throw new Error(`Invalid login: 535 for abcdefghijklmnop`);
      },
    };
    expect(await sendFeedbackMail(email, { config, transport })).toBe(false);
    expect(JSON.stringify(warn.mock.calls)).not.toContain("abcdefghijklmnop");
    expect(warn).toHaveBeenCalled();
  });
});
