import { normalizeSpace } from "../../src/lib/contracts/protocol-engine.mjs";

function extractRowsFromText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    const match = line.match(/^(\d+(?:\.\d+)*)(\s+|$)/);
    const clause = match ? match[1] : "";
    return {
      clause,
      clientText: line,
      ourText: "",
      agreedText: "",
    };
  });
}

export function buildMockAiResult(step, inputText) {
  if (step.mockAiResult) {
    return step.mockAiResult;
  }

  const rows = extractRowsFromText(inputText);
  const comments = rows.map((row, index) => ({
    id: `${index + 1}`,
    clause: row.clause || "-",
    was: "n/a",
    now: row.clientText,
    severity: "moderate",
    comment: `auto-analysis: ${normalizeSpace(row.clientText)}`,
    guidance: "manual review recommended",
  }));

  return {
    summary: `rows: ${rows.length}`,
    recommendation: "review client changes",
    rows,
    comments,
  };
}
