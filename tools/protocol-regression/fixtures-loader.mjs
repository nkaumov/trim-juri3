import fs from "node:fs/promises";
import path from "node:path";

function decodeJsonBuffer(buffer) {
  if (!buffer || buffer.length === 0) return "";

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.slice(3).toString("utf-8");
  }

  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.slice(2).toString("utf16le");
  }

  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - 2);
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString("utf16le");
  }

  const hasNulls = buffer.includes(0x00);
  if (hasNulls) {
    return buffer.toString("utf16le");
  }

  return buffer.toString("utf-8");
}

async function readJson(filePath) {
  const rawBuffer = await fs.readFile(filePath);
  const rawText = decodeJsonBuffer(rawBuffer).trim();
  if (!rawText) {
    throw new Error(`empty json file: ${filePath}`);
  }
  return JSON.parse(rawText);
}

export async function loadFixtures(baseDir) {
  const entries = await fs.readdir(baseDir, { withFileTypes: true });
  const cases = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const caseDir = path.join(baseDir, entry.name);
    const files = await fs.readdir(caseDir);
    const stepFiles = files.filter((name) => name.startsWith("step") && name.endsWith(".json"));
    stepFiles.sort((a, b) => a.localeCompare(b, "en"));

    const steps = [];
    for (const file of stepFiles) {
      const filePath = path.join(caseDir, file);
      const data = await readJson(filePath);
      steps.push({ file, data });
    }

    let context = {};
    const contextPath = path.join(caseDir, "context.json");
    try {
      context = await readJson(contextPath);
    } catch {
      context = {};
    }

    cases.push({
      id: entry.name,
      dir: caseDir,
      context,
      steps,
    });
  }

  return cases;
}
