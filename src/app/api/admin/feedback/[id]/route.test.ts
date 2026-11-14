import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owner: null as object | null, remove: vi.fn() }));
vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => mocks.owner) }));
vi.mock("@/lib/prisma", () => ({ prisma: { feedback: { delete: mocks.remove } } }));

import { DELETE } from "./route";

const call = (id: string) => DELETE(new Request(`http://x/api/admin/feedback/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  mocks.owner = { user: { id: "cmowner0001" } };
  mocks.remove.mockReset().mockResolvedValue({});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("DELETE /api/admin/feedback/:id", () => {
  it("does not exist for anyone but the owner, and deletes nothing for them", async () => {
    mocks.owner = null;
    expect((await call("cmfeedback01")).status).toBe(404);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("deletes the submission and answers 204 with no body", async () => {
    const res = await call("cmfeedback01");
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(mocks.remove).toHaveBeenCalledWith({ where: { id: "cmfeedback01" } });
  });

  it("refuses an id that isn't shaped like one, before asking the database", async () => {
    for (const id of ["", "a b", "a/b", "x".repeat(65), "a;drop", "../etc"]) {
      expect((await call(id)).status, id).toBe(400);
    }
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("says 404 when it's already gone or the table doesn't exist, and doesn't hide any other failure", async () => {
    mocks.remove.mockRejectedValue(Object.assign(new Error("not found"), { code: "P2025" }));
    expect((await call("cmfeedback01")).status).toBe(404);
    mocks.remove.mockRejectedValue(Object.assign(new Error("no table"), { code: "P2021" }));
    expect((await call("cmfeedback01")).status).toBe(404);
    mocks.remove.mockRejectedValue(new Error("connection reset"));
    expect((await call("cmfeedback01")).status).toBe(500);
  });
});
