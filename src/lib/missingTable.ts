// Whether a database error means a table or column is not there yet (the SQL in prisma/*.sql has not been run), so the new features can say so
// plainly and carry on instead of failing. One definition for the telemetry, activity, playlist picture and holiday theme code.

export function isMissingTable(err: unknown): boolean {
  const { code, message } = (err ?? {}) as { code?: unknown; message?: unknown };
  return code === "P2021" || code === "P2022" || (typeof message === "string" && /does not exist/i.test(message));
}
