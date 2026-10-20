/**
 * The interactive shell behind `hypit chat` and the `hypit-free` launcher.
 *
 * One implementation serves both launchers: the Free binary is the same shell with the Free Runtime
 * Profile already selected and a narrower prompt. Everything it runs goes back through the launcher,
 * so a chat command can never do more than the launcher itself.
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  ensureFreeProject,
  ensureProjectMarker,
  freeRuntimeProfileTemplate,
  hasSelectedProfile,
  runtimeProfileFileName,
  selectRuntimeProfile,
} from "./project-scaffold.mjs";

/** Providers the Free Runtime Profile declares; these need no API key. */
const freeProviders = [
  ["image.opencv.local", "OpenCV image transform/compose (local Python)"],
  ["media.local", "local media processing (ffmpeg)"],
  ["html.local", "browser capture and render (local Chromium)"],
];

export async function runChatRepl({ launcher, distributionRoot, version, mode = "distribution" }) {
  const free = mode === "free";
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({
    input: process.stdin, output: process.stdout, prompt: free ? "hypit-free> " : "hypit> ",
  });
  const runLauncher = (args, cwd = process.cwd()) => new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [launcher, ...args], { stdio: "inherit", cwd, windowsHide: true });
    child.once("error", reject);
    child.once("close", (code) => resolveRun(code ?? 1));
  });

  console.log(free
    ? "Hypit FREE/OSS mode (no paid APIs). Type /help, /free, /models, /exit."
    : "Hypit interactive CLI. Type /help for commands, /exit to quit.");
  console.log(`Free local providers (no API key): ${freeProviders.map(([id]) => id).join(", ")}`);
  rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed === "") { rl.prompt(); continue; }
    if (trimmed === "/exit" || trimmed === "/quit" || trimmed === "exit" || trimmed === "quit") { rl.close(); break; }
    if (trimmed === "/help") {
      console.log("Slash commands:");
      console.log("  /help                       show this help");
      console.log("  /free                       list free local providers");
      console.log("  /models                     list available models/provider packages");
      console.log("  /version                    print hypit version");
      console.log("  /doctor [project]           run doctor");
      console.log("  /init <dir>                 create a new project dir");
      console.log("  /initfree <dir>             create a free/local (no API key) project dir");
      console.log("  /profile                    print the free local runtime profile template");
      console.log("  /exit, /quit                leave chat");
      console.log("Other lines are executed as `hypit` commands (e.g. 'check build.svml', 'plan build.svrun').");
      rl.prompt();
      continue;
    }
    if (trimmed === "/free") {
      console.log("Free local (no API key) providers:");
      for (const [id, description] of freeProviders) console.log(`  ${id.padEnd(19)} - ${description}`);
      console.log("These are declared by the Free Runtime Profile (/initfree <dir>) with pricing.kind: 'local'.");
      console.log("Not declared by default:");
      console.log("  whisperx.local      - local speech alignment; it runs its own service, so add it to");
      console.log("                        hypit.runtime.json endpoints only when you need captions, then run");
      console.log("                        hypit runtime up --endpoint whisperx.local");
      rl.prompt();
      continue;
    }
    if (trimmed === "/version") {
      console.log(version);
      rl.prompt();
      continue;
    }
    if (trimmed === "/models") {
      console.log("Provider packages to install per project:");
      console.log("  Free:    @hypit/provider-image-opencv-local, @hypit/media-local, @hypit/provider-html-local");
      console.log("  Speech:  @hypit/provider-whisperx-local (local, needs its own service)");
      console.log("  Paid:    @hypit/provider-hypihub (recommended hosted), @hypit/provider-hiapi, @hypit/provider-pollo, @hypit/provider-beatapi, @hypit/provider-monid, @hypit/provider-tokendance");
      console.log("  Paid speech: @hypit/elevenlabs-speech, @hypit/fishaudio-speech, @hypit/mimo-speech");
      console.log("Install in project: npm install <package>, then add it to hypit.runtime.json endpoints.");
      rl.prompt();
      continue;
    }
    if (trimmed === "/profile" || trimmed.startsWith("/profile ")) {
      try {
        console.log("Free Runtime Profile (free local providers only):");
        console.log(JSON.stringify(freeRuntimeProfileTemplate(distributionRoot), undefined, 2));
        console.log(`Use it with /initfree <dir>, or copy it over a project's ${runtimeProfileFileName} and run:`);
        console.log(`  hypit runtime use ./${runtimeProfileFileName}`);
      } catch (error) {
        console.log(error instanceof Error ? error.message : String(error));
      }
      rl.prompt();
      continue;
    }
    if (trimmed === "/init" || trimmed.startsWith("/init ")) {
      const argument = trimmed.slice("/init".length).trim();
      if (argument.length === 0) { console.log("usage: /init <dir>"); rl.prompt(); continue; }
      const target = resolve(process.cwd(), argument);
      const created = ensureProjectMarker(target).created;
      console.log(created ? `Created Hypit project at ${target}` : `${target} already has a package.json; leaving it unchanged.`);
      if (existsSync(join(target, runtimeProfileFileName))) {
        console.log(`${runtimeProfileFileName} is already there; select it with: hypit runtime use ./${runtimeProfileFileName}`);
      } else {
        await runLauncher(["runtime", "init", "--project", target]);
        console.log(`Next: cd ${argument} && hypit runtime up`);
      }
      rl.prompt();
      continue;
    }
    if (trimmed === "/initfree" || trimmed.startsWith("/initfree ")) {
      const argument = trimmed.slice("/initfree".length).trim();
      if (argument.length === 0) { console.log("usage: /initfree <dir>"); rl.prompt(); continue; }
      const target = resolve(process.cwd(), argument);
      const { created, profile } = ensureFreeProject(target, distributionRoot);
      if (created.profile) console.log(`Created the Free Runtime Profile at ${join(target, runtimeProfileFileName)} (free local providers only).`);
      else if (profile === "other") console.log(`${target} already has its own ${runtimeProfileFileName}; leaving it unchanged.`);
      else console.log(`${target} already has the Free Runtime Profile.`);
      if (profile !== "other" && (created.profile || !hasSelectedProfile(target))) {
        await selectRuntimeProfile({ launcher, projectRoot: target });
      }
      console.log(`Next: cd ${argument} && hypit runtime up`);
      rl.prompt();
      continue;
    }
    // Execute as a hypit command in a child process so output streams.
    await runLauncher((trimmed.startsWith("/") ? trimmed.slice(1) : trimmed).split(/\s+/));
    rl.prompt();
  }
  // The shell is the whole invocation: the launcher must never fall through to command dispatch
  // with `chat` still in argv.
  process.exit(0);
}
