import { readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const ignored = new Set([".git", ".venv", "node_modules", "dist", "coverage", ".pytest_cache"]);

async function markdownFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await markdownFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".md")) result.push(path);
  }
  return result;
}

const failures = [];
let links = 0;
for (const file of await markdownFiles(root)) {
  const source = await import("node:fs/promises").then(({ readFile }) => readFile(file, "utf8"));
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const raw = match[1].trim().replace(/^<|>$/g, "");
    if (/^(?:https?:|mailto:|#)/i.test(raw)) continue;
    const pathPart = raw.split("#", 1)[0];
    if (pathPart === "") continue;
    links += 1;
    const target = resolve(dirname(file), decodeURIComponent(pathPart));
    try {
      await stat(target);
    } catch {
      const line = source.slice(0, match.index).split("\n").length;
      failures.push(`${file.slice(root.length + 1)}:${line} -> ${raw}`);
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`Broken local Markdown links:\n${failures.map((item) => `- ${item}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Checked ${links} local Markdown links.\n`);
}
