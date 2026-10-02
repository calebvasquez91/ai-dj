import { describe, expect, it } from "vitest";
import { describeApiError } from "@/lib/apiError";

function prismaError(code: string, meta?: Record<string, unknown>) {
  return Object.assign(new Error(`Prisma ${code}`), { code, meta, name: "PrismaClientKnownRequestError" });
}

describe("describeApiError", () => {
  it("maps a userId foreign-key violation (stale session user) to 401", () => {
    const out = describeApiError(prismaError("P2003", { modelName: "FxSound", field_name: "FxSound_userId_fkey (index)" }));
    expect(out.status).toBe(401);
    expect(out.error).toMatch(/sign in/i);
  });

  it("recognizes the userId FK from the message alone or an object-shaped meta (pg driver adapter)", () => {
    const fromMessage = Object.assign(new Error("Foreign key constraint violated on the constraint: `FxSound_userId_fkey`"), {
      code: "P2003",
    });
    expect(describeApiError(fromMessage).status).toBe(401);
    const fromObjectMeta = Object.assign(new Error("fk"), { code: "P2003", meta: { constraint: { index: "Playlist_userId_fkey" } } });
    expect(describeApiError(fromObjectMeta).status).toBe(401);
  });

  it("maps any other foreign-key violation to 409", () => {
    expect(describeApiError(prismaError("P2003", { field_name: "PlaylistTrack_trackId_fkey (index)" })).status).toBe(409);
    expect(describeApiError(prismaError("P2003")).status).toBe(409);
  });

  it("maps unique-constraint violations to 409", () => {
    expect(describeApiError(prismaError("P2002", { target: ["email"] })).status).toBe(409);
  });

  it("maps record-not-found to 404", () => {
    expect(describeApiError(prismaError("P2025")).status).toBe(404);
  });

  it("maps invalid-value errors to 400", () => {
    for (const code of ["P2000", "P2006", "P2007", "P2020", "P2023"]) {
      expect(describeApiError(prismaError(code)).status).toBe(400);
    }
  });

  it("maps connectivity/timeout errors to 503", () => {
    for (const code of ["P1001", "P1002", "P1008", "P1017", "P2024", "P2028"]) {
      expect(describeApiError(prismaError(code)).status).toBe(503);
    }
    const init = Object.assign(new Error("can't reach"), { name: "PrismaClientInitializationError" });
    expect(describeApiError(init).status).toBe(503);
  });

  it("maps malformed JSON bodies to 400", () => {
    let thrown: unknown;
    try {
      JSON.parse("{not json");
    } catch (e) {
      thrown = e;
    }
    expect(describeApiError(thrown).status).toBe(400);
  });

  it("falls back to a generic 500 without leaking the raw message", () => {
    const out = describeApiError(new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2"));
    expect(out).toEqual({ status: 500, error: "Something went wrong on our end." });
    expect(describeApiError("a string").status).toBe(500);
    expect(describeApiError(null).status).toBe(500);
    expect(describeApiError(undefined).status).toBe(500);
  });

  it("treats an unknown Prisma code as a 500", () => {
    expect(describeApiError(prismaError("P9999")).status).toBe(500);
  });
});
