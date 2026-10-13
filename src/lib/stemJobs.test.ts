import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/storage", () => ({ uploadBlobFile: vi.fn() }));
vi.mock("replicate", () => ({ default: class {} }));

import { stemWebhookUrl } from "./stemJobs";

describe("stemWebhookUrl", () => {
  it("points Replicate back at this deployment over https", () => {
    expect(stemWebhookUrl("https://ai-dj-gamma.vercel.app/api/tracks/t1/stems?auto=1")).toBe(
      "https://ai-dj-gamma.vercel.app/api/stems/webhook"
    );
  });

  it("registers nothing when Replicate couldn't reach the server (local dev, plain http)", () => {
    expect(stemWebhookUrl("http://localhost:3000/api/tracks/t1/stems")).toBeNull();
    expect(stemWebhookUrl("https://localhost:3000/api/x")).toBeNull();
    expect(stemWebhookUrl("http://127.0.0.1:3000/api/x")).toBeNull();
    expect(stemWebhookUrl("https://app.test/api/x")).toBeNull();
    expect(stemWebhookUrl("http://example.com/api/x")).toBeNull();
    expect(stemWebhookUrl("not a url")).toBeNull();
  });
});
