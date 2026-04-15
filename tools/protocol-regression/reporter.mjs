import fs from "node:fs/promises";
import path from "node:path";

export async function writeJson(filePath, data) {
  const content = JSON.stringify(data, null, 2);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
}

export function buildSummaryMarkdown(summary) {
  const lines = [];
  lines.push(`# Protocol Regression Summary`);
  lines.push(``);
  lines.push(`Generated: ${summary.generatedAt}`);
  lines.push(`Output: ${summary.outputDir}`);
  lines.push(`Zip: ${summary.zipPath || "n/a"}`);
  lines.push(``);
  for (const item of summary.cases) {
    lines.push(`## ${item.id}`);
    lines.push(`- Steps: ${item.steps}`);
    lines.push(`- Failures: ${item.failures}`);
    lines.push(`- Status: ${item.failures === 0 ? "PASS" : "FAIL"}`);
    if (item.outputDir) {
      lines.push(`- Output: ${item.outputDir}`);
    }
    lines.push(``);
    if (item.failureDetails.length) {
      lines.push(`### Failures`);
      for (const detail of item.failureDetails) {
        lines.push(`- ${detail}`);
      }
      lines.push(``);
    }
  }
  if (summary.errors.length) {
    lines.push(`## Runner errors`);
    for (const err of summary.errors) {
      lines.push(`- ${err}`);
    }
  }
  return lines.join("\n");
}
