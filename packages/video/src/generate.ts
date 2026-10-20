import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import {
  cliProviderLine,
  cliProviderView,
  createCliScratchResources,
  openCliRuntimeHost,
  selectCliProvider,
} from "@hypit/hypit/cli";
import type { CliApplicationContext, CliCapabilityOffer, CliIo } from "@hypit/hypit/cli";
import { generationTypes, isMediaPort, verifyGeneratedVideoSet } from "@hypit/generation";
import type {
  GenerationMediaPort,
  GenerationMediaRole,
  GenerationPortValue,
  GenerationScalarPort,
} from "@hypit/generation";
import { exactModelsFromFacets } from "@hypit/generation/model";
import type { ExactModelEndpoint } from "@hypit/generation/model";
import { loadNodePackageSelection, physicalPackageName } from "@hypit/hypit/loader/node";
import type { BlobRef, Need } from "@hypit/hypit/protocol";
import type { ResourceStore } from "@hypit/hypit/runtime";

/**
 * One-shot video generation from the command line.
 *
 * A Build is the right shape for a whole production: many requests, durable state, a Result that
 * outlives the terminal. A single take is not. This command asks the Runtime Profile for one
 * exact model, sends that model's own request through the Endpoint the Profile selected, and
 * writes the returned video to a file — no Build, no Result, no project state.
 *
 * Every model fact stays with the model package. The command reads the exact model's declared
 * ports, so `--duration`, `--resolution`, `--aspect-ratio` and the rest mean exactly what that
 * model's own vocabulary says they mean.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
};

type Parsed = {
  readonly model?: string;
  readonly to?: string;
  readonly list: boolean;
  readonly json: boolean;
  readonly runtime?: string;
  readonly project?: string;
  readonly personReference: boolean;
  /** Every other option, keyed by its kebab-case name; repeatable. */
  readonly values: ReadonlyMap<string, readonly string[]>;
  /** Item fields addressed as `<port>.<field>`. */
  readonly fields: ReadonlyMap<string, ReadonlyMap<string, string>>;
};

/** `referenceImage` is `--reference-image`; the model's own port name stays the source of truth. */
function optionName(port: string): string {
  return port.replace(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase();
}

/** `take.mp4` becomes `take-2.mp4`, `take-3.mp4` and so on. */
function numberedPath(path: string, index: number): string {
  const extension = extname(path);
  const stem = extension.length === 0 ? path : path.slice(0, -extension.length);
  return `${stem}-${index}${extension}`;
}

function parse(argv: readonly string[]): Parsed {
  const values = new Map<string, string[]>();
  const fields = new Map<string, Map<string, string>>();
  let model: string | undefined;
  let to: string | undefined;
  let runtime: string | undefined;
  let project: string | undefined;
  let list = false;
  let json = false;
  let personReference = false;
  for (let index = 1; index < argv.length; index += 1) {
    const item = argv[index]!;
    if (item === "--json") { json = true; continue; }
    if (item === "--list") { list = true; continue; }
    if (["--debug", "--verbose", "--no-color"].includes(item)) continue;
    if (item === "--color") { index += 1; continue; }
    assert(item.startsWith("--"), `unexpected argument ${item}`);
    const name = item.slice(2);
    assert(name.length > 0, "an option needs a name");
    const value = argv[++index];
    assert(value !== undefined && !value.startsWith("--"), `${item} requires a value`);
    if (name === "model") {
      assert(model === undefined, "--model cannot be repeated");
      model = value;
      continue;
    }
    if (name === "to") {
      assert(to === undefined, "--to cannot be repeated");
      to = value;
      continue;
    }
    if (name === "runtime") {
      assert(runtime === undefined, "--runtime cannot be repeated");
      runtime = value;
      continue;
    }
    if (name === "project") {
      assert(project === undefined, "--project cannot be repeated");
      project = value;
      continue;
    }
    if (name === "person-reference") {
      assert(personReference === false, "--person-reference cannot be repeated");
      personReference = value === "true";
      assert(value === "true" || value === "false", "--person-reference is true or false");
      continue;
    }
    if (name === "field") {
      const separator = value.indexOf("=");
      assert(separator > 0, "--field is <port>.<field>=<value>");
      const port = value.slice(0, value.indexOf("."));
      const field = value.slice(value.indexOf(".") + 1, separator);
      assert(port.length > 0 && field.length > 0, "--field is <port>.<field>=<value>");
      const portFields = fields.get(port) ?? new Map<string, string>();
      assert(!portFields.has(field), `--field ${port}.${field} is repeated`);
      portFields.set(field, value.slice(separator + 1));
      fields.set(port, portFields);
      continue;
    }
    const existing = values.get(name) ?? [];
    existing.push(value);
    values.set(name, existing);
  }
  return {
    ...(model === undefined ? {} : { model }),
    ...(to === undefined ? {} : { to }),
    ...(runtime === undefined ? {} : { runtime }),
    ...(project === undefined ? {} : { project }),
    list,
    json,
    personReference,
    values,
    fields,
  };
}

function mediaTypeFor(path: string): { readonly mediaType: string; readonly role: GenerationMediaRole } {
  const mediaType = MEDIA_TYPES[extname(path).toLowerCase()];
  assert(mediaType !== undefined,
    `${path} is not a media file Hypit can read; use a png, jpg, webp, mp4, mov, webm, wav, mp3 or m4a file`);
  return { mediaType, role: mediaType.split("/")[0] as GenerationMediaRole };
}

function scalarValue(port: GenerationScalarPort, raw: string): string | number | boolean {  const kind = port.value;
  if (kind.kind === "boolean") {
    assert(raw === "true" || raw === "false", `--${optionName(port.name)} is true or false`);
    return raw === "true";
  }
  if (kind.kind === "number") {
    const value = Number(raw);
    assert(raw.trim().length > 0 && Number.isFinite(value), `--${optionName(port.name)} is a number`);
    return value;
  }
  if (kind.kind === "enum") {
    const numbers = kind.values.every((item) => typeof item === "number");
    if (numbers) {
      const value = Number(raw);
      assert(raw.trim().length > 0 && Number.isFinite(value), `--${optionName(port.name)} is a number`);
      return value;
    }
    return raw;
  }
  return raw;
}

/** What the model accepts for this port, so a missing value explains itself. */
function acceptedValues(port: GenerationScalarPort): string {
  const kind = port.value;
  if (kind.kind === "boolean") return "true or false";
  if (kind.kind === "enum") return `one of ${kind.values.join(", ")}`;
  if (kind.kind === "number") {
    if (kind.minimum === undefined && kind.maximum === undefined) {
      return kind.integer === true ? "a whole number" : "a number";
    }
    return `a number from ${kind.minimum ?? "any"} to ${kind.maximum ?? "any"}`;
  }
  return "text";
}

async function readText(raw: string, cwd: string): Promise<string> {
  if (!raw.startsWith("@")) return raw;
  const path = resolve(cwd, raw.slice(1));
  return await readFile(path, "utf8");
}

async function mediaValue(
  port: GenerationMediaPort,
  path: string,
  resources: ResourceStore,
  fields: ReadonlyMap<string, string>,
  personReference: boolean,
): Promise<GenerationPortValue> {
  const { mediaType, role } = mediaTypeFor(path);
  assert(port.value.accepts.includes(role),
    `${port.name} accepts ${port.value.accepts.join(", ")}, not ${role}`);
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(path));
  } catch (error) {
    throw new Error(`${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  const artifact: BlobRef = await resources.put(bytes, mediaType);
  const declared = port.value.itemFields ?? [];
  const itemFields: Record<string, string | number | boolean> = {};
  for (const field of declared) {
    const supplied = fields.get(field.name) ?? (field.name === "personReference"
      ? (personReference ? "true" : "false")
      : undefined);
    if (supplied === undefined) {
      assert(field.optional === true, `${port.name} requires the ${field.name} of every reference`);
      continue;
    }
    itemFields[field.name] = scalarValue({ name: field.name, minItems: 1, maxItems: 1, value: field.value },
      supplied) as string | number | boolean;
  }
  return {
    role,
    artifact,
    ...(declared.length === 0 ? {} : { fields: itemFields }),
  };
}

async function buildRequest(input: {
  readonly endpoint: ExactModelEndpoint;
  readonly parsed: Parsed;
  readonly resources: ResourceStore;
  readonly cwd: string;
}): Promise<{ readonly request: unknown; readonly supplied: readonly string[] }> {
  const { endpoint, parsed, resources, cwd } = input;
  const ports: Record<string, GenerationPortValue[]> = {};
  const supplied: string[] = [];
  const known = new Set(endpoint.ports.ports.map((port) => optionName(port.name)));
  for (const name of parsed.values.keys()) {
    assert(known.has(name),
      `${endpoint.ports.model} has no ${name} input; its inputs are ${[...known].sort().join(", ")}`);
  }
  for (const port of endpoint.ports.ports) {
    const name = optionName(port.name);
    const raw = parsed.values.get(name) ?? [];
    if (isMediaPort(port)) {
      if (raw.length === 0) continue;
      const values: GenerationPortValue[] = [];
      for (const item of raw) {
        values.push(await mediaValue(
          port,
          resolve(cwd, item),
          resources,
          parsed.fields.get(port.name) ?? new Map<string, string>(),
          parsed.personReference,
        ));
      }
      ports[port.name] = values;
      supplied.push(name);
      continue;
    }
    if (raw.length === 0) {
      const fallback = port.value.default;
      if (fallback === undefined) {
        assert(port.minItems === 0, `${endpoint.ports.model} requires --${name} (${acceptedValues(port)})`);
        continue;
      }
      ports[port.name] = [fallback];
      supplied.push(name);
      continue;
    }
    assert(raw.length === 1, `--${name} takes one value`);
    const value = port.value.kind === "text" || port.value.kind === "token"
      ? await readText(raw[0]!, cwd)
      : scalarValue(port, raw[0]!);
    ports[port.name] = [value];
    supplied.push(name);
  }
  return { request: endpoint.sealRequest(ports), supplied };
}

function videoModels(offers: readonly CliCapabilityOffer[]): readonly CliCapabilityOffer[] {
  return offers.filter((offer) =>
    offer.returns.module.name === generationTypes.videoSet.module.name
    && offer.returns.module.version === generationTypes.videoSet.module.version
    && offer.returns.name === generationTypes.videoSet.name);
}

function modelKey(offer: CliCapabilityOffer): string {
  return `${offer.capability.module.name}@${offer.capability.module.version}#${offer.capability.name}`;
}

export function writeGenerateHelp(io: CliIo): void {
  io.write([
    "hypit generate",
    "Generate one video through the exact model the selected Runtime Profile serves.",
    "",
    "  hypit generate --model <model> --prompt <text> [--to <video.mp4>]",
    "  hypit generate --list",
    "",
    "Options",
    "  --model <model>            the exact model, such as seedance-2-mini",
    "  --prompt <text>            the prompt; @<file> reads the text from a file",
    "  --to <video.mp4>           where to write the video (default: <model>.mp4)",
    "  --list                     the video capabilities this Runtime Profile serves",
    "  --runtime <profile>        the Runtime Profile to use",
    "  --project <directory>      the project directory to use",
    "",
    "Every other option names one input the selected model declares, in kebab case:",
    "--duration, --resolution, --aspect-ratio, --quality, --generate-audio, --web-search,",
    "--seed, --count, --reference-image, --reference-video, --reference-audio,",
    "--first-frame and --last-frame. Media options take a file path and may be repeated.",
    "",
    "A reference that shows a person needs --person-reference true. Any other declared field is",
    "addressed as --field <port>.<field>=<value>.",
    "",
    "This is one immediate request: no Build, no Result and no project state is created.",
    "The Provider's own prices apply; the Runtime Profile decides which Endpoint serves the model.",
    "",
  ].join("\n"));
}

export async function runGenerateCli(
  argv: readonly string[],
  io: CliIo,
  application: CliApplicationContext,
): Promise<void> {
  if (argv.includes("--help")) { writeGenerateHelp(io); return; }
  const parsed = parse(argv);
  const { profile, host, projectRoot } = await openCliRuntimeHost(application, parsed.runtime, parsed.project);
  const offers = await host.capabilities();
  const models = videoModels(offers);
  if (parsed.list) {
    const view = {
      format: "hypit.video-generate-models@1",
      profile,
      capabilities: models.map((offer) => ({
        capability: offer.capability.name,
        module: `${offer.capability.module.name}@${offer.capability.module.version}`,
        endpoints: offer.endpoints,
      })),
    };
    if (parsed.json) { io.write(`${JSON.stringify(view, null, 2)}\n`); return; }
    if (models.length === 0) { io.write(`No video capability is served by ${profile}\n`); return; }
    io.write(`Video capabilities served by ${profile}\n`);
    for (const offer of models) {
      io.write(`  ${offer.capability.name}  ${offer.capability.module.name}@${offer.capability.module.version}\n`);
    }
    return;
  }
  assert(models.length > 0,
    `No Endpoint in ${profile} serves a video generation capability; run hypit doctor --runtime ${profile} to see what this Profile serves`);
  const selected = parsed.model === undefined
    ? (models.length === 1 ? models[0]! : undefined)
    : models.find((offer) => offer.capability.name === parsed.model || modelKey(offer) === parsed.model);
  assert(selected !== undefined,
    parsed.model === undefined
      ? `Several video models are served by ${profile}: ${models.map((offer) => offer.capability.name).join(", ")}; choose one with --model`
      : `${profile} does not serve the video model ${parsed.model}; it serves ${models.map((offer) => offer.capability.name).join(", ")}`);

  const packageName = physicalPackageName(selected.capability.module.name);
  const distributionRoot = application.distribution.packageRoot;
  const loaded = await loadNodePackageSelection([packageName], projectRoot, {
    ...(distributionRoot === undefined ? {} : { fallbackRoots: [distributionRoot] }),
  });
  const endpoints = loaded.flatMap((pack) => exactModelsFromFacets(pack.contribution.facets ?? []));
  const endpoint = endpoints.find((candidate) =>
    candidate.capability.module.name === selected.capability.module.name
    && candidate.capability.module.version === selected.capability.module.version
    && candidate.capability.name === selected.capability.name);
  assert(endpoint !== undefined,
    `${selected.capability.name} is not an exact generation model; hypit generate serves the exact video models that a Model package declares`);

  const resources = createCliScratchResources();
  const { request, supplied } = await buildRequest({ endpoint, parsed, resources, cwd: application.cwd });
  const need: Need = {
    id: `need:hypit-generate-${endpoint.ports.model}`,
    capability: endpoint.capability,
    returns: endpoint.returns,
    constraints: request as never,
    result: "record:hypit-generate",
  };
  const provider = await selectCliProvider(host, need, profile);
  if (!parsed.json) io.write(`Generating with ${cliProviderLine(provider)}\n`);
  const report = parsed.json ? io.writeProgress : io.writeProgress ?? io.write;
  let previousPhase: string | undefined;
  const fulfillment = await host.invoke(need, resources, {
    reportProgress: async (progress) => {
      if (progress.phase === previousPhase) return;
      previousPhase = progress.phase;
      report?.(`  · ${progress.phase}\n`);
    },
    reportDiagnostic: async (diagnostic) => { report?.(`  · ${diagnostic.message}\n`); },
  });
  assert(fulfillment.value.kind === "inline", "the generated video came back by reference");
  verifyGeneratedVideoSet(fulfillment.value.value);
  const videos = (fulfillment.value.value as unknown as { readonly videos: readonly BlobRef[] }).videos;
  const target = resolve(application.cwd, parsed.to ?? `${endpoint.ports.model}.mp4`);
  await mkdir(dirname(target), { recursive: true });
  const written: { readonly path: string; readonly bytes: number }[] = [];
  for (const [index, video] of videos.entries()) {
    const bytes = await resources.get(video.resource);
    assert(bytes !== undefined, `the generated video ${video.resource} is unavailable`);
    // A model that returns several videos keeps the requested name for the first one.
    const path = index === 0 ? target : numberedPath(target, index + 1);
    assert(!(await stat(path).then(() => true, () => false)), `Destination ${path} already exists`);
    await writeFile(path, bytes, { flag: "wx" });
    written.push({ path, bytes: bytes.length });
  }
  const view = {
    format: "hypit.video-generate@1",
    profile,
    model: endpoint.ports.model,
    capability: `${endpoint.capability.module.name}@${endpoint.capability.module.version}#${endpoint.capability.name}`,
    inputs: supplied,
    ...cliProviderView(provider),
    videos: videos.length,
    path: target,
    bytes: written[0]?.bytes ?? 0,
    ...(written.length === 1 ? {} : { files: written }),
  };
  if (parsed.json) { io.write(`${JSON.stringify(view, null, 2)}\n`); return; }
  io.write(`✓ Video written\n\n  ${endpoint.ports.model}  ${videos.length} video${videos.length === 1 ? "" : "s"}\n`
    + `${written.map((file) => `  ${file.path}\n`).join("")}`);
}
