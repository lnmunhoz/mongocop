import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const home = await mkdtemp(join(tmpdir(), "mongocop-config-"));
process.env.HOME = home;

try {
  const config = await import("../src/lib/config.js");
  const configDir = join(home, ".mongocop");
  const configFile = join(configDir, "config.json");

  await mkdir(configDir, { recursive: true });
  await writeFile(
    configFile,
    JSON.stringify({
      hosts: [
        {
          name: "localhost",
          kind: "inline",
          connectionString: "mongodb://localhost:27017",
        },
      ],
    }) + "\n",
    "utf-8"
  );

  assert.deepEqual((await config.loadConfig()).templates, []);

  const template = {
    name: "prod to staging",
    sourceHost: "production",
    targetHost: "staging",
    sourceDatabase: "app",
    targetDatabase: "app_copy",
    collections: ["users", "orders"],
  };

  await config.addTemplate(template);
  assert.deepEqual(await config.loadConfig(), {
    hosts: [
      {
        name: "localhost",
        kind: "inline",
        connectionString: "mongodb://localhost:27017",
      },
    ],
    templates: [template],
  });

  await config.renameTemplate("prod to staging", "daily refresh");
  assert.equal((await config.loadConfig()).templates[0]?.name, "daily refresh");

  await config.removeTemplate("daily refresh");
  assert.deepEqual((await config.loadConfig()).templates, []);

  await config.addTemplate({
    ...template,
    name: "safe template",
  });
  const raw = await readFile(configFile, "utf-8");
  assert(!raw.includes("mongodb+srv://user:pass@example.com"));
} finally {
  await rm(home, { recursive: true, force: true });
}
