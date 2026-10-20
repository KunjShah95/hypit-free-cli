/**
 * Project scaffolding shared by the `hypit` and `hypit-free` launchers.
 *
 * Both launchers must create the same project marker, the same Free Runtime Profile and the same
 * Runtime selection; keeping that here is what stops the two interactive shells from drifting.
 * This module ships inside `bin/`, so it is present in an installed Distribution.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

/** The Runtime Profile file a project selects, in the project root. */
export const runtimeProfileFileName = "hypit.runtime.json";

/** The Free Runtime Profile template, relative to the Distribution root. */
const freeProfileSegments = ["examples", "free-local-runtime.json"];

/**
 * Scaffolding is not a Migration: existing files are read as the author's work and left untouched.
 * Returns whether this call created the marker.
 */
export function ensureProjectMarker(projectRoot) {
  const root = resolve(projectRoot);
  mkdirSync(root, { recursive: true });
  const projectFile = join(root, "package.json");
  if (existsSync(projectFile)) return { projectFile, created: false };
  writeFileSync(projectFile, `${JSON.stringify({
    hypit: { project: true }, name: basename(root), private: true,
  }, undefined, 2)}\n`);
  return { projectFile, created: true };
}

/**
 * The template is part of the Distribution's published files; a missing template means the
 * installation is incomplete, so say that instead of writing a project with no providers.
 */
export function freeRuntimeProfileTemplate(distributionRoot) {
  const templateFile = join(resolve(distributionRoot), ...freeProfileSegments);
  let text;
  try {
    text = readFileSync(templateFile, "utf8");
  } catch (error) {
    throw new Error(`The Free Runtime Profile template is missing from this Hypit installation: ${templateFile}. `
      + "Reinstall @hypit/hypit; if the published package is at fault, report it at "
      + "https://github.com/hypit-ai/hypit/issues.", { cause: error });
  }
  return JSON.parse(text);
}

/**
 * Whether the CLI has already selected a Runtime Profile for this project. This only probes the
 * selection the CLI owns; the format stays with `@hypit/runtime-local`, which also explains why a
 * selection path occupied by a directory counts as no selection.
 */
export function hasSelectedProfile(projectRoot) {
  try {
    return statSync(join(resolve(projectRoot), ".hypit", "runtime")).isFile();
  } catch {
    return false;
  }
}

/**
 * Give `projectRoot` the Free Runtime Profile without overwriting an author's own files.
 * `profile` is "created", "unchanged" (already the Free Profile) or "other" (the author's own).
 */
export function ensureFreeProject(projectRoot, distributionRoot) {
  const root = resolve(projectRoot);
  const { projectFile, created: project } = ensureProjectMarker(root);
  const profileFile = join(root, runtimeProfileFileName);
  const finish = (profile, profileCreated) => ({
    projectRoot: root, projectFile, profileFile, profile, created: { project, profile: profileCreated },
  });
  if (!existsSync(profileFile)) {
    writeFileSync(profileFile, `${JSON.stringify(freeRuntimeProfileTemplate(distributionRoot), undefined, 2)}\n`);
    return finish("created", true);
  }
  let profile;
  try {
    profile = JSON.stringify(JSON.parse(readFileSync(profileFile, "utf8"))) === JSON.stringify(freeRuntimeProfileTemplate(distributionRoot))
      ? "unchanged" : "other";
  } catch {
    // A Profile that cannot be read is the author's to fix; scaffolding never rewrites it.
    profile = "other";
  }
  return finish(profile, false);
}

/**
 * Remember a Runtime Profile by running the Distribution's own `runtime use`, so the selection file
 * keeps one owner. Runs in `projectRoot` because the Profile is named relative to the project.
 *
 * The command's own output is re-emitted on stderr: selecting a Profile is a launcher side effect,
 * and `--json` commands must keep stdout to the one document they were asked for.
 */
export function selectRuntimeProfile({ launcher, projectRoot }) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath,
      [launcher, "runtime", "use", `./${runtimeProfileFileName}`],
      { cwd: resolve(projectRoot), stdio: ["inherit", "pipe", "inherit"], windowsHide: true });
    let output = "";
    child.stdout?.setEncoding("utf8").on("data", (text) => { output += text; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (output.length > 0) process.stderr.write(output);
      resolveRun(code ?? 1);
    });
  });
}
