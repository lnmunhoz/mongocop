import { execSync } from "child_process";
import { readFileSync } from "fs";

const run = (cmd) => execSync(cmd, { encoding: "utf-8" }).trim();

// Find latest tag
let lastTag;
try {
  lastTag = run("git describe --tags --abbrev=0");
} catch {
  console.log("No tags found — this will be the first release.\n");
  lastTag = null;
}

// Get commits since last tag (or all commits)
const range = lastTag ? `${lastTag}..HEAD` : "";
const log = run(`git log ${range} --oneline`);

if (!log) {
  console.log("No new commits since last release. Nothing to do.");
  process.exit(0);
}

console.log(`Changes since ${lastTag ?? "beginning"}:\n`);
console.log(log);
console.log();

// Get detailed diff stats
const diffStat = run(`git diff ${lastTag ? lastTag + "..HEAD" : "HEAD"} --stat`);

// Read current README
const readme = readFileSync("README.md", "utf-8");

// Build prompt for Claude
const prompt = `You are updating the README.md for a CLI tool before a release.

Here are the commits since the last release (${lastTag ?? "first release"}):
${log}

Here is the diff stat:
${diffStat}

Here is the current README.md:
${readme}

Instructions:
- Update the README to reflect any new user-facing features, changed behavior, or removed functionality based on the commits above.
- Keep the existing structure and tone. Do not add sections that don't exist unless clearly needed.
- Do not add badges, shields, or emojis.
- Do not add a changelog section — that's handled separately.
- If nothing user-facing changed, output the README exactly as-is.
- Output ONLY the updated README content, nothing else.`;

console.log("Asking Claude to update README...\n");

try {
  const updated = execSync("claude --print --model haiku", {
    input: prompt,
    encoding: "utf-8",
    maxBuffer: 1024 * 1024,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();

  if (updated && updated !== readme.trim()) {
    const { writeFileSync } = await import("fs");
    writeFileSync("README.md", updated + "\n");
    console.log("README.md updated. Review the changes:\n");
    try {
      const diff = run("git diff README.md");
      console.log(diff);
    } catch {
      console.log("(no diff to show)");
    }
  } else {
    console.log("No README changes needed.");
  }
} catch (err) {
  console.error("Failed to run Claude CLI:", err.message);
  console.log(
    "\nFalling back to manual mode — review commits above and update README.md if needed."
  );
}
