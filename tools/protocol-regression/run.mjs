import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { runProtocolEngine, applyManualPatch } from "../../src/lib/contracts/protocol-engine.mjs";
import { loadFixtures } from "./fixtures-loader.mjs";
import { buildMockAiResult } from "./mock-ai.mjs";
import { runAssertions } from "./assertions.mjs";
import { writeJson, buildSummaryMarkdown } from "./reporter.mjs";
import { zipOutput } from "./zip.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function run() {
  const root = path.resolve(__dirname, "..", "..");
  const fixturesDir = path.join(root, "tests", "protocol-fixtures");
  const outDir = path.join(root, "out", "protocol-regression", `${Date.now()}`);
  await fs.mkdir(outDir, { recursive: true });

  const cases = await loadFixtures(fixturesDir);
  const summary = {
    generatedAt: new Date().toISOString(),
    outputDir: outDir,
    zipPath: null,
    cases: [],
    errors: [],
  };

  for (const testCase of cases) {
    const caseOut = path.join(outDir, testCase.id);
    await fs.mkdir(caseOut, { recursive: true });

    let state = {
      rows: [],
      comments: [],
      summary: "",
      recommendation: "",
      requestHistory: [],
    };

    const failureDetails = [];

    for (let i = 0; i < testCase.steps.length; i += 1) {
      const stepInfo = testCase.steps[i];
      const step = stepInfo.data;
      const stepOut = path.join(caseOut, `step-${String(i + 1).padStart(2, "0")}`);
      await fs.mkdir(stepOut, { recursive: true });

      const prevState = JSON.parse(JSON.stringify(state));

      let stepResult = {};
      if (step.type === "manual-edit") {
        const patched = applyManualPatch(state.rows, step.patchRows || []);
        state = { ...state, rows: patched };
        stepResult = { mode: "manual-edit", rows: patched.length };
      } else {
        const inputText = step.extractedText || step.message || "";
        const mockAiResult = buildMockAiResult(step, inputText);
        const engineResult = await runProtocolEngine({
          mode: step.type,
          templateText: testCase.context.templateText || "",
          existingRows: state.rows,
          existingComments: state.comments,
          existingProtocolText: testCase.context.protocolText || "",
          newInputText: inputText,
          rulesText: testCase.context.rulesText || "",
          lawsText: testCase.context.lawsText || "",
          requestHistory: state.requestHistory,
          mockAiResult,
          now: new Date().toISOString(),
        });
        state = {
          rows: engineResult.rows,
          comments: engineResult.comments,
          summary: engineResult.summary,
          recommendation: engineResult.recommendation,
          requestHistory: engineResult.requestHistory,
        };
        stepResult = { mode: step.type, rows: engineResult.rows.length };
      }

      const issues = runAssertions(prevState, state, step.expectations || {});
      if (issues.length) {
        for (const issue of issues) {
          failureDetails.push(`step ${i + 1}: ${issue}`);
        }
      }

      await writeJson(path.join(stepOut, "contract-state.json"), state);
      await writeJson(path.join(stepOut, "protocol-rows.json"), state.rows);
      await writeJson(path.join(stepOut, "protocol-comments.json"), state.comments);
      await writeJson(path.join(stepOut, "request-log.json"), state.requestHistory);
      await writeJson(path.join(stepOut, "step-result.json"), {
        step,
        result: stepResult,
        issues,
      });
    }

    summary.cases.push({
      id: testCase.id,
      outputDir: caseOut,
      steps: testCase.steps.length,
      failures: failureDetails.length,
      failureDetails,
    });
  }

  const summaryPath = path.join(outDir, "summary.json");
  await writeJson(summaryPath, summary);

  const summaryMd = buildSummaryMarkdown(summary);
  await fs.writeFile(path.join(outDir, "summary.md"), summaryMd, "utf-8");

  try {
    const zipPath = path.join(outDir, "..", `${path.basename(outDir)}.zip`);
    const result = await zipOutput(outDir, zipPath);
    summary.zipPath = result;
    if (!result) {
      summary.errors.push("zip failed: unavailable");
    }
    await writeJson(summaryPath, summary);
    await fs.writeFile(path.join(outDir, "summary.md"), buildSummaryMarkdown(summary), "utf-8");
  } catch (err) {
    summary.errors.push(`zip failed: ${err?.message || "unknown"}`);
    await writeJson(summaryPath, summary);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
