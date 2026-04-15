import path from "node:path";
import { spawn } from "node:child_process";

export async function zipOutput(dirPath, outPath) {
  if (process.platform === "win32") {
    const command = "powershell";
    const args = [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path "${dirPath}\\*" -DestinationPath "${outPath}" -Force`,
    ];
    await exec(command, args);
    return outPath;
  }

  try {
    await exec("zip", ["-r", outPath, path.basename(dirPath)], { cwd: path.dirname(dirPath) });
    return outPath;
  } catch {
    return null;
  }
}

function exec(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", ...options });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`command failed: ${command}`));
      }
    });
  });
}
