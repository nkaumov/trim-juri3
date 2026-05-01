function stripCodeFences(value: string): string {
  const trimmed = String(value || "").trim();
  if (!trimmed.startsWith("```")) return trimmed;
  const lines = trimmed.split("\n");
  if (lines.length < 3) return trimmed;
  if (!lines[0].startsWith("```")) return trimmed;
  if (!lines[lines.length - 1].startsWith("```")) return trimmed;
  return lines.slice(1, -1).join("\n").trim();
}

function tryJsonParse(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function extractJsonFromText(value: string): { json: unknown | null; cleanedText: string } {
  const raw = String(value || "");
  const cleaned = stripCodeFences(raw);

  const direct = tryJsonParse(cleaned);
  if (direct !== null) return { json: direct, cleanedText: cleaned };

  const firstObj = cleaned.indexOf("{");
  const lastObj = cleaned.lastIndexOf("}");
  if (firstObj >= 0 && lastObj > firstObj) {
    const slice = cleaned.slice(firstObj, lastObj + 1);
    const parsed = tryJsonParse(slice);
    if (parsed !== null) return { json: parsed, cleanedText: slice };
  }

  const firstArr = cleaned.indexOf("[");
  const lastArr = cleaned.lastIndexOf("]");
  if (firstArr >= 0 && lastArr > firstArr) {
    const slice = cleaned.slice(firstArr, lastArr + 1);
    const parsed = tryJsonParse(slice);
    if (parsed !== null) return { json: parsed, cleanedText: slice };
  }

  return { json: null, cleanedText: cleaned };
}

