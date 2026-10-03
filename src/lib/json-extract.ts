/**
 * Parses the JSON object in a Claude reply. Claude sometimes wraps JSON in a
 * ```json ... ``` fence despite being asked for "only JSON" — strip it
 * defensively rather than trusting the instruction to always be followed.
 * Throws (JSON.parse) on anything that still isn't valid JSON; callers catch.
 */
export function extractJsonObject(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}
