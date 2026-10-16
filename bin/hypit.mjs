#!/usr/bin/env node

import { register } from "tsx/esm/api";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
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

// Bootstrap and package activation must agree on the physical Distribution root. Windows short
// paths can survive Node's ordinary resolution while package lookup expands them through libuv.
const distributionRoot = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const distributionUrl = pathToFileURL(distributionRoot + sep);
register();
const { installDistributionPackageResolution } =
  await import(new URL("packages/loader/src/node/distribution-resolution.ts", distributionUrl).href);
installDistributionPackageResolution([distributionRoot]);
const args = process.argv.slice(2);

if (args.length === 0) {
  console.log("Tip: run `hypit chat` for an interactive REPL. Plain `hypit` lists the command help below.");
}
// Interactive chat mode: "hypit chat" drops into a REPL that runs hypit commands
// and exposes free/local provider info. Models opencode's chat-style UX.
if (args[0] === "chat" || args[0] === "repl") {
  const readline = await import("node:readline/promises");
  const { stdin, stdout } = process;
  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: "hypit> " });
  console.log("Hypit interactive CLI (free/local). Type /help for commands, /exit to quit.");
  console.log("Free local providers (no API key): image.opencv.local, whisperx.local (needs service), media.local, html.local");
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "" ) { rl.prompt(); continue; }
    if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "exit" || trimmed === "quit") { rl.close(); break; }
    if (trimmed === "/help") {
      console.log("Slash commands:");
      console.log("  /help                       show this help");
      console.log("  /free                       list free local providers");
      console.log("  /models                     list available models/provider packages");
      console.log("  /version                    print hypit version");
      console.log("  /doctor [project]           run doctor");
      console.log("  /init <dir>                 create a new project dir");
      console.log("  /initfree <dir>            create a free/local (no API key) project");
      console.log("  /profile                   show free local runtime profile template");
      console.log("  /exit, /quit                leave chat");
      console.log("Other lines are executed as `hypit` commands (e.g. 'check build.svml', 'plan build.svrun').");
      rl.prompt();
      continue;
    }
    if (trimmed === "/free") {
      console.log("Free local (no API key) providers:");
      console.log("  image.opencv.local  - OpenCV image transform/compose (python3)");
      console.log("  media.local         - local media processing");
      console.log("  html.local          - browser capture/render (Chromium)");
      console.log("  whisperx.local      - local speech alignment (needs local whisperx service)");
      console.log("Use these in hypit.runtime.json 'endpoints'. They declare pricing.kind: 'local'.");
      rl.prompt();
      continue;
    }
    if (trimmed === "/version") {
      console.log("0.3.1");
      rl.prompt();
      continue;
    }
    if (trimmed === "/models") {
      console.log("Provider packages to install per project:");
      console.log("  Free:    @hypit/provider-image-opencv-local, @hypit/media-local, @hypit/provider-html-local, @hypit/provider-whisperx-local");
      console.log("  Paid:    @hypit/provider-hypihub (recommended hosted), @hypit/provider-hiapi, @hypit/provider-pollo, @hypit/provider-beatapi, @hypit/provider-monid, @hypit/provider-tokendance");
      console.log("  Speech:  @hypit/elevenlabs-speech, @hypit/fishaudio-speech, @hypit/mimo-speech");
      console.log("Install in project: npm install <package>, then add to hypit.runtime.json endpoints.");
      rl.prompt();
      continue;
    }
    if (trimmed === "/profile" || trimmed.startsWith("/profile ")) {
      console.log("Free local profile template: see examples/free-local-runtime.json in the hypit repo.");
      console.log("Copy it over hypit.runtime.json, run: hypit runtime init --force is not supported; instead:");
      console.log("  cp examples/free-local-runtime.json ./hypit.runtime.json && hypit runtime use ./hypit.runtime.json");
      rl.prompt();
      continue;
    }
    if (trimmed.startsWith("/initfree ")) {
      const dir = trimmed.slice("/initfree ".length).trim();
      if (dir.length === 0) { console.log("usage: /initfree <dir>"); rl.prompt(); continue; }
      const fs = await import("node:fs");
      const path = await import("node:path");
      fs.mkdirSync(dir, { recursive: true });
      if (!fs.existsSync(path.join(dir, "package.json"))) {
        fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ hypit: { project: true }, name: path.basename(dir), private: true }, null, 2) + "\n");
      }
      const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
      const tpl = JSON.parse(fs.readFileSync(path.join(repoRoot, "examples", "free-local-runtime.json"), "utf8"));
      fs.writeFileSync(path.join(dir, "hypit.runtime.json"), JSON.stringify(tpl, null, 2) + "\n");
      console.log("Created free/local project at", dir);
      console.log("Next: cd " + dir + " && hypit runtime up --endpoint image.opencv.local --endpoint media.local --endpoint html.local");
      rl.prompt();
      continue;
    }
    // Execute as hypit command in a child process so output streams.
    const { spawn } = await import("node:child_process");
    const childArgs = trimmed.startsWith("/") ? trimmed.slice(1).split(/\s+/) : trimmed.split(/\s+/);
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...childArgs], {
      stdio: "inherit",
      cwd: process.cwd(),
    });
    await new Promise((resolvePromise) => child.on("close", resolvePromise));
    rl.prompt();
  }
  process.exit(0);
}

const { runInstalledCliApplication, runNodeCli } = await import(new URL("packages/cli/src/index.ts", distributionUrl).href);
const { createVideoDistribution } = await import("@hypit/video");
const videoDistribution = createVideoDistribution({
  packageRoot: distributionRoot,
  launcher: fileURLToPath(import.meta.url),
});
await runNodeCli(args, async (argv, io) => await runInstalledCliApplication(argv, io, {
  distribution: videoDistribution,
  distributionRoot,
  launcher: fileURLToPath(import.meta.url),
}));
