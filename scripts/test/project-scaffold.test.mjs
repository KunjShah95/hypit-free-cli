import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureFreeProject,
  ensureProjectMarker,
  freeRuntimeProfileTemplate,
  hasSelectedProfile,
} from "../../bin/project-scaffold.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), "hypit-scaffold-"));
  t.after(() => rm(root, { recursive: true, force: true, maxRetries: 3 }));
  return root;
}

test("the Free Runtime Profile declares only endpoints that need no service or key", async () => {
  const profile = freeRuntimeProfileTemplate(repositoryRoot);
  assert.equal(profile.format, "hypit.runtime-local@1");
  // A declared endpoint must be usable after `runtime up`; whisperx.local runs its own service and
  // is therefore opt-in, which is what keeps `hypit doctor` green in a new free project.
  assert.deepEqual(Object.keys(profile.endpoints).sort(), ["html.local", "image.opencv.local", "media.local"]);
});

test("a missing template is reported as an incomplete installation", async (t) => {
  const root = await scratch(t);
  assert.throws(() => freeRuntimeProfileTemplate(root), /Free Runtime Profile template is missing/);
});

test("scaffolding creates the project marker once and never rewrites one", async (t) => {
  const root = await scratch(t);
  const project = join(root, "project");
  assert.equal(ensureProjectMarker(project).created, true);
  assert.deepEqual(JSON.parse(await readFile(join(project, "package.json"), "utf8")), {
    hypit: { project: true }, name: "project", private: true,
  });
  await writeFile(join(project, "package.json"), '{"name":"author"}\n');
  assert.equal(ensureProjectMarker(project).created, false);
  assert.equal(await readFile(join(project, "package.json"), "utf8"), '{"name":"author"}\n');
});

test("a free project is created once, then reported as unchanged", async (t) => {
  const root = await scratch(t);
  const project = join(root, "project");
  const first = ensureFreeProject(project, repositoryRoot);
  assert.deepEqual(first.created, { project: true, profile: true });
  assert.equal(first.profile, "created");
  const written = await readFile(join(project, "hypit.runtime.json"), "utf8");
  assert.deepEqual(Object.keys(JSON.parse(written).endpoints).sort(), ["html.local", "image.opencv.local", "media.local"]);

  const second = ensureFreeProject(project, repositoryRoot);
  assert.deepEqual(second.created, { project: false, profile: false });
  assert.equal(second.profile, "unchanged");
});

test("a project's own Runtime Profile is left to its author", async (t) => {
  const root = await scratch(t);
  const project = join(root, "project");
  const own = '{\n  "endpoints": {}\n}\n';
  await ensureProjectMarker(project);
  await writeFile(join(project, "hypit.runtime.json"), own);

  const result = ensureFreeProject(project, repositoryRoot);
  assert.equal(result.profile, "other");
  assert.equal(result.created.profile, false);
  assert.equal(await readFile(join(project, "hypit.runtime.json"), "utf8"), own);
});

test("the selection probe follows the CLI's own rule for the selection path", async (t) => {
  const root = await scratch(t);
  const project = join(root, "project");
  await ensureProjectMarker(project);
  assert.equal(hasSelectedProfile(project), false);

  await mkdir(join(project, ".hypit"), { recursive: true });
  await writeFile(join(project, ".hypit", "runtime"), "hypit.runtime.json\n");
  assert.equal(hasSelectedProfile(project), true);

  // A selection path occupied by a directory is no selection, exactly as `runtime use` treats it.
  await rm(join(project, ".hypit", "runtime"));
  await mkdir(join(project, ".hypit", "runtime"));
  assert.equal(hasSelectedProfile(project), false);
});

test("the Free Runtime Profile template is a published file", async () => {
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const template = "examples/free-local-runtime.json";
  assert.ok(existsSync(join(repositoryRoot, template)), `${template} must exist`);
  // `bin/hypit-free.mjs` reads the template from the installed package, so it has to be packed.
  assert.ok(manifest.files.includes(template), `${template} must be listed in package.json files`);
});
