---
title: CLI quickstart
description: Use Hypit from the command line and through the interactive chat, including with free local providers.
---

Hypit is distributed as `@hypit/hypit` with the `hypit` executable. Its command surface
covers authoring (`check`, `plan`, `pricing`, `build`), Result inspection (`builds`,
`history`, `logs`, `status`, `inspect`, `get`), one-shot generation (`generate`),
credentials and Runtime operation (`doctor`, `auth`, `runtime`, `programs`, `paths`).

## Install and run

```bash
# No install: run directly with npx
npx @hypit/hypit --version

# Or install globally
npm install -g @hypit/hypit
hypit --version
```

The package installs two launchers: `hypit`, and `hypit-free` for work that uses local Providers
only.

## One-shot video generation

```bash
# The video capabilities the selected Runtime Profile serves
hypit generate --list

# Generate one take through the Endpoint that Profile selected
hypit generate --model seedance-2-mini \
  --prompt "A lighthouse at dusk." --duration 5 --to take.mp4
```

`generate` is one immediate request: the model submits the work, the command waits for the
Provider to finish and writes the returned video to a file. No Build, no Result and no project
state is created. The Provider's own prices apply, and the Runtime Profile decides which
Endpoint serves the model.

Every input keeps the meaning the selected model declares: `--duration`, `--resolution`,
`--aspect-ratio`, `--quality`, `--generate-audio`, `--web-search`, `--seed` and the media
options (`--reference-image`, `--reference-video`, `--reference-audio`, `--first-frame`,
`--last-frame`) are that model's own ports. A reference that shows a person needs
`--person-reference true`.

## Interactive chat mode (like OpenCode)

```bash
hypit chat
```

This drops into a small REPL that:

- Runs any `hypit` command typed as a line (`check build.svml`, `plan build.svrun`).
- Creates projects: `/init <dir>` writes a project with the Distribution's own starter Profile,
  `/initfree <dir>` writes one that declares local Providers only. Both select the Profile they
  wrote, so `hypit runtime up` works in the new directory.
- Supports `/help`, `/free`, `/models`, `/profile`, `/version`, `/doctor [project]`, `/exit`.

For environments without an interactive TTY, use `--json` on any command instead.

## A minimal free/local workflow

`hypit-free` does the setup: in a directory with no project yet it writes `package.json` with the
`hypit.project` marker, writes `hypit.runtime.json` from the Free Runtime Profile, and selects it.
It then runs whatever you asked for, or opens the shell when you ask for nothing.

```bash
# 1. Make a project directory and set it up (no API key, no credentials)
mkdir my-video && cd my-video
hypit-free

# 2. Review hypit.runtime.json: it declares the free local Providers listed below.
#    Run this once to prepare and start them; the browser download is one time.
hypit runtime up

# 3. Check an author source, then build
hypit check some-source.svml
hypit plan some-run.svrun
hypit build some-run.svrun --follow
```

A Profile you wrote yourself is never overwritten, and `hypit-free` leaves an explicit
`runtime init`, `runtime use` or `runtime unset` alone.

## Free open-source providers (no key required)

| Endpoint | Package | What it does | Requirement |
| --- | --- | --- | --- |
| `image.opencv.local` | `@hypit/provider-image-opencv-local` | Image transform/compose | Python (installed by `runtime up`) |
| `media.local` | `@hypit/media-local` | Media processing | built-in |
| `html.local` | `@hypit/provider-html-local` | Browser capture/render | Chromium (installed by `runtime up`) |
| `whisperx.local` | `@hypit/provider-whisperx-local` | Word-level speech alignment | its own local service |

These declare `pricing.kind: "local"` and need no credentials. Use `hypit doctor` to verify them.

The first three are what the Free Runtime Profile declares, so a new `hypit-free` project is ready
after `runtime up`. `whisperx.local` runs a separate local service, so it stays out of that Profile:
add it to `hypit.runtime.json` when you want word-level speech alignment, then run
`hypit runtime up --endpoint whisperx.local`.

## Paid/hosted providers (need accounts/API keys)

HypiHub (recommended hosted), HiAPI, Pollo, BeatAPI, Monid, TokenDance for video/image
generation models; ElevenLabs/FishAudio/Mimo for speech. Connect with `hypit auth login <endpoint>`
after selecting a Runtime Profile. See [Models and Providers](./providers.md) and
[model and deployment services](./service-partners.md).

## Bring your own OSS model

Hypit does not bundle a local LLM/video generator. To use open-source generation models:

1. Run an OpenAI-compatible endpoint yourself (vLLM, Ollama, ComfyUI, etc.).
2. Read an existing project Provider example (`examples/provider-package`) and implement the
   same Model–Provider–Endpoint contract for your service.
3. Install that package into your video project, add the endpoint to `hypit.runtime.json`,
   bind the capability in `bindings`, and run `hypit runtime up`.

Credentials: `credential-store-env` reads from environment variables; `credential-store-local`
reads a local file or the OS keychain. Auth flow: `hypit auth status <endpoint>`.

## Where this fits

Hypit's CLI is command-oriented; it is not itself a chat agent. Pair it with a coding agent
(Claude Code, Codex, ...) that reads `skills/hypit/SKILL.md` and drives these commands.
When you want a terminal-first flow without an agent, use `hypit chat`.
