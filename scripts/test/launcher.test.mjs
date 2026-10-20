/**
 * The launcher shell is what a developer meets first, and it is the one surface a Distribution can
 * break without any package test noticing: these tests run the real launchers the way a user does.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const hypit = join(repositoryRoot, "bin", "hypit.mjs");
const hypitFree = join(repositoryRoot, "bin", "hypit-free.mjs");
const version = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8")).version;

/** Run one launcher, feeding an interactive shell its lines on stdin. */
function runLauncher(script, args, { cwd, input = [], stateHome, timeoutMs = 90_000 }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env: { ...process.env, ...(stateHome === undefined ? {} : { HYPIT_STATE_HOME: stateHome }) },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (text) => { stdout += text; });
    child.stderr.setEncoding("utf8").on("data", (text) => { stderr += text; });
    // A shell that never exits must fail the test by name instead of holding the whole suite.
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`hypit ${args.join(" ")} did not exit within ${timeoutMs} ms\n${stdout}\n${stderr}`));
    }, timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => { clearTimeout(timer); resolveRun({ code, stdout, stderr }); });
    child.stdin.end(input.length === 0 ? "" : `${input.join("\n")}\n`);
  });
}

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "hypit-launcher-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

test("the Free launcher prints the packaged version", async () => {
  const result = await runLauncher(hypitFree, ["--version"], { cwd: repositoryRoot });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout.trim(), version);
});

test("chat answers /version and /profile from the installation", async (t) => {
  const root = await scratch(t);
  const result = await runLauncher(hypit, ["chat"], {
    cwd: root, stateHome: join(root, "state"), input: ["/version", "/profile", "/exit"],
  });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, new RegExp(version.replaceAll(".", "\\.")));
  assert.match(result.stdout, /"format": "hypit\.runtime-local@1"/u);
  assert.match(result.stdout, /@hypit\/provider-html-local/u);
});

test("/initfree creates a free project and selects the Free Runtime Profile", async (t) => {
  const root = await scratch(t);
  const project = join(root, "free-project");
  const result = await runLauncher(hypit, ["chat"], {
    cwd: root, stateHome: join(root, "state"), input: [`/initfree ${project}`, "/exit"],
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(project, "package.json"), "utf8")).hypit, { project: true });
  const profile = JSON.parse(await readFile(join(project, "hypit.runtime.json"), "utf8"));
  assert.deepEqual(Object.keys(profile.endpoints).sort(), ["html.local", "image.opencv.local", "media.local"]);
  assert.equal((await readFile(join(project, ".hypit", "runtime"), "utf8")).trim(), "hypit.runtime.json");
});

test("/init creates a project with a selected Runtime Profile", async (t) => {
  const root = await scratch(t);
  const project = join(root, "plain-project");
  const result = await runLauncher(hypit, ["chat"], {
    cwd: root, stateHome: join(root, "state"), input: [`/init ${project}`, "/exit"],
  });
  assert.equal(result.code, 0, result.stderr);
  assert.ok(existsSync(join(project, "hypit.runtime.json")), result.stdout);
  assert.equal((await readFile(join(project, ".hypit", "runtime"), "utf8")).trim(), "hypit.runtime.json");
});

test("the Free launcher prepares its directory for commands", async (t) => {
  const root = await scratch(t);
  const project = join(root, "project");
  await mkdir(project);
  const result = await runLauncher(hypitFree, ["paths", "--json"], {
    cwd: project, stateHome: join(root, "state"),
  });
  assert.equal(result.code, 0, result.stderr);
  // Launcher notices belong on stderr, so the document is the whole of stdout.
  const paths = JSON.parse(result.stdout);
  assert.equal(paths.format, "hypit.cli-paths@1");
  assert.equal(paths.profileSource, "project");
  assert.equal(paths.profile, await realpath(join(project, "hypit.runtime.json")));
});
