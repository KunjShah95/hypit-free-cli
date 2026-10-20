#!/usr/bin/env node

import { register } from "tsx/esm/api";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runChatRepl } from "./chat-repl.mjs";
import {
  ensureFreeProject,
  hasSelectedProfile,
  runtimeProfileFileName,
  selectRuntimeProfile,
} from "./project-scaffold.mjs";

// The version this launcher prints and the version `hypit-free` reports in chat are the same manifest.
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

const distributionRoot = realpathSync.native(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const distributionUrl = pathToFileURL(distributionRoot + sep);
register();
const { installDistributionPackageResolution } =
  await import(new URL("packages/loader/src/node/distribution-resolution.ts", distributionUrl).href);
installDistributionPackageResolution([distributionRoot]);
const launcher = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);

// Free mode: this directory becomes a free/local project. A Runtime Profile the author already owns
// is never rewritten, and an explicit `runtime use`/`runtime unset`/`runtime init` is left alone —
// that is also what stops selecting the Profile from spawning the same selection again.
const managesProfile = args[0] === "runtime" && ["init", "use", "unset"].includes(args[1]);
if (!managesProfile) {
  const project = ensureFreeProject(process.cwd(), distributionRoot);
  // Launcher notices go to stderr: stdout belongs to the command that was asked for, and `--json`
  // commands must stay machine-readable on their first run in a project.
  if (project.created.profile) {
    console.error(`Hypit (FREE/OSS): created ${runtimeProfileFileName} with free local providers only.`);
  } else if (project.profile === "other") {
    console.error(`Hypit (FREE/OSS): keeping this project's own ${runtimeProfileFileName}.`);
  }
  if (project.profile !== "other" && (project.created.profile || !hasSelectedProfile(project.projectRoot))) {
    await selectRuntimeProfile({ launcher, projectRoot: project.projectRoot });
  }
}

// No command drops into the free shell, exactly like `hypit chat`.
if (args.length === 0 || args[0] === "chat" || args[0] === "repl") {
  await runChatRepl({ launcher, distributionRoot, version: manifest.version, mode: "free" });
}

const { runInstalledCliApplication, runNodeCli } = await import(new URL("packages/cli/src/index.ts", distributionUrl).href);
const { createVideoDistribution } = await import("@hypit/video");
const videoDistribution = createVideoDistribution({
  packageRoot: distributionRoot,
  launcher,
});

await runNodeCli(args, async (argv, io) => await runInstalledCliApplication(argv, io, {
  distribution: videoDistribution,
  distributionRoot,
  launcher,
}));
