import { readFile } from "fs/promises";
import path from "path";

const promptCache = new Map<string, string>();

export async function loadPrompt(name: string): Promise<string> {
  const cached = promptCache.get(name);
  if (cached) {
    return cached;
  }
  const filePath = path.join(process.cwd(), "src", "prompts", name);
  const content = await readFile(filePath, "utf-8");
  promptCache.set(name, content);
  return content;
}

export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => vars[key] ?? "");
}
