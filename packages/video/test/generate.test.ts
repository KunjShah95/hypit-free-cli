import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { CliApplicationContext, CliIo, CliProviderQuery, CliRuntimeHost } from "@hypit/cli";
import { generationTypes } from "@hypit/generation";
import { canonicalize } from "@hypit/hypit/protocol";
import type { Need, StoredValue } from "@hypit/hypit/protocol";
import type { ResourceStore } from "@hypit/hypit/runtime";

import { runGenerateCli } from "../src/generate.js";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const capability = { module: { name: "@hypit/seedance", version: "1" }, name: "seedance-2-mini" } as const;

type Recorded = { need?: Need };

function io(): { readonly io: CliIo; text: () => string } {
  let out = "";
  return {
    io: {
      write: (chunk) => { out += chunk; },
      setExitCode: () => {},
      readSecret: async () => "",
      terminal: { isTTY: false, color: false, unicode: false, columns: 100 },
    },
    text: () => out,
  };
}

/** A Runtime that serves one exact video model and hands back the bytes it was given. */
function host(video: Uint8Array, recorded: Recorded = {}): CliRuntimeHost {
  return {
    profile: "selected.json",
    capabilities: async () => [{
      capability,
      returns: generationTypes.videoSet,
      endpoints: ["hypihub.default"],
    }],
    providers: async (queries: readonly CliProviderQuery[]) => queries.map((query) => ({
      request: query.request,
      capability: query.capability,
      status: "resolved" as const,
      endpoint: "hypihub.default",
      use: "@hypit/provider-hypihub",
      pricing: { kind: "page" as const, url: "https://hypit.ai/pricing" },
    })),
    invoke: async (need: Need, resources: ResourceStore): Promise<{ readonly value: StoredValue }> => {
      recorded.need = need;
      const artifact = await resources.put(video, "video/mp4");
      return { value: { kind: "inline", value: canonicalize({ videos: [artifact] }) } };
    },
  } as unknown as CliRuntimeHost;
}

function application(directory: string, runtime: CliRuntimeHost): CliApplicationContext {
  return {
    cwd: directory,
    resolveProjectRoot: async () => repositoryRoot,
    distribution: {
      packageRoot: repositoryRoot,
      resolveProjectRuntime: async () => ({ profile: "selected.json" }),
      openRuntimeHost: async () => runtime,
    },
  } as unknown as CliApplicationContext;
}

test("generate sends one exact model's own request and writes the returned video", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypit-generate-"));
  const video = new Uint8Array([1, 2, 3, 4, 5]);
  const requests: Recorded = {};
  try {
    const output = io();
    await runGenerateCli([
      "generate", "--model", "seedance-2-mini", "--prompt", "A lighthouse at dusk.",
      "--duration", "5", "--to", "take.mp4",
    ], output.io, application(directory, host(video, requests)));
    assert.match(output.text(), /Video written/u);
    assert.deepEqual(await readFile(join(directory, "take.mp4")), Buffer.from(video));
    const need = requests.need as unknown as { readonly capability: typeof capability; readonly constraints: { readonly ports: Record<string, readonly unknown[]> } };    assert.deepEqual(need.capability, capability);
    // The model's own port table decides the request: the prompt, the chosen duration, and the
    // defaults the model declares for resolution, aspect ratio, generated audio and web search.
    assert.deepEqual(need.constraints.ports.prompt, ["A lighthouse at dusk."]);
    assert.deepEqual(need.constraints.ports.duration, [5]);
    assert.deepEqual(need.constraints.ports.resolution, ["720p"]);
    assert.deepEqual(need.constraints.ports.aspectRatio, ["9:16"]);
    assert.deepEqual(need.constraints.ports.generateAudio, [false]);
    assert.deepEqual(need.constraints.ports.webSearch, [false]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("generate names the models the selected Profile serves", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypit-generate-"));
  try {
    const output = io();
    await runGenerateCli(["generate", "--list"], output.io, application(directory, host(new Uint8Array([0]))));
    assert.match(output.text(), /seedance-2-mini/u);
    assert.match(output.text(), /@hypit\/seedance@1/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("generate refuses a model the selected Profile does not serve", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypit-generate-"));
  try {
    const output = io();
    await assert.rejects(runGenerateCli(["generate", "--model", "seedance-2", "--prompt", "x"],
      output.io, application(directory, host(new Uint8Array([0])))),
    /does not serve the video model seedance-2/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("generate refuses an input the selected model does not declare", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypit-generate-"));
  try {
    const output = io();
    await assert.rejects(runGenerateCli([
      "generate", "--model", "seedance-2-mini", "--prompt", "x", "--duration", "5", "--quality", "720p",
    ], output.io, application(directory, host(new Uint8Array([0])))),
    /has no quality input/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("generate explains a required input the model declares no default for", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypit-generate-"));
  try {
    const output = io();
    await assert.rejects(runGenerateCli([
      "generate", "--model", "seedance-2-mini", "--prompt", "x",
    ], output.io, application(directory, host(new Uint8Array([0])))),
    /seedance-2-mini requires --duration \(a number from 4 to 15\)/u);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("generate sends a reference image with the person fact the model declares", async () => {
  const directory = await mkdtemp(join(tmpdir(), "hypit-generate-"));
  const recorded: Recorded = {};
  const image = join(directory, "presenter.png");
  await writeFile(image, new Uint8Array([137, 80, 78, 71]));
  try {
    const output = io();
    await runGenerateCli([
      "generate", "--model", "seedance-2-mini", "--prompt", "A presenter looks up.",
      "--duration", "5", "--reference-image", image, "--person-reference", "true", "--to", "take.mp4",
    ], output.io, application(directory, host(new Uint8Array([7]), recorded)));
    const ports = recorded.need?.constraints as { readonly ports: Record<string, readonly { role: string; artifact: { mediaType: string }; fields?: Record<string, unknown> }[]> };
    assert.equal(ports.ports.referenceImage?.length, 1);
    assert.equal(ports.ports.referenceImage?.[0]?.role, "image");
    assert.equal(ports.ports.referenceImage?.[0]?.artifact.mediaType, "image/png");
    assert.deepEqual(ports.ports.referenceImage?.[0]?.fields, { personReference: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
