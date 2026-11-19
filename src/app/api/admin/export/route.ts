// GET /api/admin/export?kind=audit|uploads|devices&from=YYYY-MM-DD&to=YYYY-MM-DD&type=<event type>: the Activity page's tables as CSV. Admin only; for
// anyone else the route does not exist (404), the same as the page. Cells that look like spreadsheet formulas are made plain text (lib/telemetry.ts).
import { apiHandler, jsonError } from "@/lib/apiRoute";
import { feedbackOwnerSession } from "@/lib/feedbackOwner";
import { parseActivityFilter } from "@/lib/activity";
import { exportRows } from "@/lib/activityServer";
import { toCsv } from "@/lib/telemetry";

async function handleGET(request: Request) {
  if (!(await feedbackOwnerSession())) return jsonError(404, "Not found.");
  const params = new URL(request.url).searchParams;
  const kind = params.get("kind") ?? "";
  const data = await exportRows(kind, parseActivityFilter(Object.fromEntries(params)));
  if (!data) return jsonError(400, "Nothing to export: an unknown kind, or its table does not exist yet.");
  return new Response(toCsv(data.columns, data.rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export const GET = apiHandler(handleGET);
