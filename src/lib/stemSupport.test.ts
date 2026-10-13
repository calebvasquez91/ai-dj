import { describe, expect, it } from "vitest";
import { stemSupport } from "./stemSupport";

describe("stemSupport", () => {
  it("is available with blob storage and a Replicate token", () => {
    expect(stemSupport({ storageBackend: "blob", hasReplicateToken: true })).toEqual({ available: true });
  });

  it("names the local storage backend as the blocker, even without a token", () => {
    const s = stemSupport({ storageBackend: "local", hasReplicateToken: false });
    expect(s).toMatchObject({ available: false, reason: "storage" });
    expect(s.available === false && s.message).toMatch(/local disk/);
  });

  it("names the missing token when storage is fine", () => {
    const s = stemSupport({ storageBackend: "blob", hasReplicateToken: false });
    expect(s).toMatchObject({ available: false, reason: "replicate" });
    expect(s.available === false && s.message).toMatch(/REPLICATE_API_TOKEN/);
  });
});
