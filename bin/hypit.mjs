#!/usr/bin/env node

import { register } from "tsx/esm/api";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runChatRepl } from "./chat-repl.mjs";

// The version the launcher prints and the version `hypit chat` reports are the same manifest.
const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
if (process.argv.length === 3 && ["--version", "-v"].includes(process.argv[2])) {
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
// Interactive chat mode: `hypit chat` drops into a REPL that runs hypit commands and exposes the
// free/local providers. The shell itself lives in ./chat-repl.mjs so `hypit-free` runs exactly the
// same one.
if (args[0] === "chat" || args[0] === "repl") {
  await runChatRepl({
    launcher: fileURLToPath(import.meta.url),
    distributionRoot,
    version: manifest.version,
  });
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
