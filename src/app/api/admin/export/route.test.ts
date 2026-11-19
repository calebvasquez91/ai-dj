import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ owner: true, rows: vi.fn() }));
vi.mock("@/lib/feedbackOwner", () => ({ feedbackOwnerSession: vi.fn(async () => (mocks.owner ? { user: { id: "u-admin" } } : null)) }));
vi.mock("@/lib/activityServer", () => ({ exportRows: mocks.rows }));

import { GET } from "./route";

const get = (qs: string) => GET(new Request(`http://x/api/admin/export?${qs}`));

beforeEach(() => {
  mocks.owner = true;
  mocks.rows.mockReset().mockResolvedValue({ columns: ["a", "b"], rows: [[1, "=cmd()"]] });
});

describe("GET /api/admin/export", () => {
  it("does not exist for anyone but the admin, and reads nothing", async () => {
    mocks.owner = false;
    expect((await get("kind=audit")).status).toBe(404);
    expect(mocks.rows).not.toHaveBeenCalled();
  });

  it("sends the admin the table as a CSV download, with formula-looking cells made plain text", async () => {
    const res = await get("kind=audit&from=2026-11-01&type=song_added");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain('filename="activity-audit.csv"');
    expect(await res.text()).toBe("a,b\r\n1,'=cmd()\r\n");
    const [kind, filter] = mocks.rows.mock.calls[0];
    expect(kind).toBe("audit");
    expect(filter.from?.toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(filter.type).toBe("song_added");
  });

  it("is a 400 for an unknown kind or a table that is not there", async () => {
    mocks.rows.mockResolvedValue(null);
    expect((await get("kind=nope")).status).toBe(400);
  });
});
