import { readFileSync, writeFileSync, chmodSync } from "fs";

const file = "dist/index.js";
let content = readFileSync(file, "utf-8");

// Replace existing shebang (e.g. tsx) or prepend node shebang
const shebang = "#!/usr/bin/env node\n";
if (content.startsWith("#!")) {
  content = content.replace(/^#!.*\n/, shebang);
} else {
  content = shebang + content;
}

writeFileSync(file, content);
chmodSync(file, 0o755);
