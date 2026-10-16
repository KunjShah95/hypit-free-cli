#!/usr/bin/env node

import { register } from "tsx/esm/api";
import { readFileSync, realpathSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep, basename } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.argv.length === 3 && ["--version", "-v"].includes(process.argv[2])) {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(manifest.version);
  process.exit(0);
}

const emitWarning = process.emitWarning;
process.emitWarning = function hypitWarning(warning, ...args) {
  const message = warning instanceof Error ? warning.message : String(warning);
  if (message === "SQLite is an experimental feature and might change at any time") return;
  return emitWarning.call(process, warning, ...args);
};

const distributionRoot = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const distributionUrl = pathToFileURL(distributionRoot + sep);
register();
const { installDistributionPackageResolution } =
  await import(new URL("packages/loader/src/node/distribution-resolution.ts", distributionUrl).href);
installDistributionPackageResolution([distributionRoot]);
const args = process.argv.slice(2);

// Free mode: ensure a free/local project profile exists in CWD if missing.
if (!existsSync(resolve(process.cwd(), "hypit.runtime.json"))) {
  const projPkg = resolve(process.cwd(), "package.json");
  if (!existsSync(projPkg)) {
    writeFileSync(projPkg, JSON.stringify({ hypit: { project: true }, name: basename(process.cwd()), private: true }, null, 2) + "\n");
  }
  const tplPath = resolve(distributionRoot, "examples", "free-local-runtime.json");
  if (existsSync(tplPath)) {
    const tpl = JSON.parse(readFileSync(tplPath, "utf8"));
    writeFileSync(resolve(process.cwd(), "hypit.runtime.json"), JSON.stringify(tpl, null, 2) + "\n");
    console.log("Hypit (FREE/OSS): created hypit.runtime.json with free local providers only.");
  }
}

const { runInstalledCliApplication, runNodeCli } = await import(new URL("packages/cli/src/index.ts", distributionUrl).href);
const { createVideoDistribution } = await import("@hypit/video");
const videoDistribution = createVideoDistribution({
  packageRoot: distributionRoot,
  launcher: fileURLToPath(import.meta.url),
});

if (args.length === 0 || args[0] === "chat") {
  // default free binary drops into chat
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: "hypit-free> " });
  console.log("Hypit FREE/OSS mode (no paid APIs). Type /help, /free, /models, /exit.");
  rl.prompt();
  for await (const line of rl) {
    const t = line.trim();
    if (t === "") { rl.prompt(); continue; }
    if (t === "/exit" || t === "/quit") { rl.close(); break; }
    if (t === "/free") { console.log("Free providers: image.opencv.local, media.local, html.local, whisperx.local"); rl.prompt(); continue; }
    if (t === "/models") { console.log("Free packages: @hypit/provider-image-opencv-local, @hypit/media-local, @hypit/provider-html-local, @hypit/provider-whisperx-local"); rl.prompt(); continue; }
    if (t === "/help") { console.log("/free /models /version /exit  (other lines run hypit commands)"); rl.prompt(); continue; }
    if (t === "/version") { const m = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")); console.log(m.version); rl.prompt(); continue; }
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...t.split(/\s+/)], { stdio: "inherit", cwd: process.cwd() });
    await new Promise((r) => child.on("close", r));
    rl.prompt();
  }
  process.exit(0);
}

await runNodeCli(args, async (argv, io) => await runInstalledCliApplication(argv, io, {
  distribution: videoDistribution,
  distributionRoot,
  launcher: fileURLToPath(import.meta.url),
}));