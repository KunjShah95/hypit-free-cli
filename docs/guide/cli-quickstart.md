---
title: CLI quickstart
description: Use Hypit from the command line and through the interactive chat, including with free local providers.
---

Hypit is distributed as `@hypit/hypit` with the `hypit` executable. Its command surface
covers authoring (`check`, `plan`, `pricing`, `build`), Result inspection (`builds`,
`history`, `logs`, `status`, `inspect`, `get`), credentials and Runtime operation
(`doctor`, `auth`, `runtime`, `programs`, `paths`).

## Install and run

```bash
# No install: run directly with npx
npx @hypit/hypit --version

# Or install globally
npm install -g @hypit/hypit
hypit --version
```

## Interactive chat mode (like OpenCode)

```bash
hypit chat
```

This drops into a small REPL that:

- Runs any `hypit` command typed as a line (`check build.svml`, `plan build.svrun`).
- Supports slash commands: `/help`, `/free`, `/models`, `/version`, `/exit`.
- Lists free local providers and available provider packages.

For environments without an interactive TTY, use `--json` on any command instead.

## A minimal free/local workflow

Everything below uses only providers that ship with Hypit and declare `pricing.kind: "local"`
(no API key, no Provider charge):

```bash
# 1. Create a project directory
mkdir my-video && cd my-video
echo '{"hypit":{"project":true},"name":"my-video","private":true}' > package.json

# 2. Create a starter Runtime Profile (free/local by default where possible)
mkdir -p .hypit/runtimes
hypit runtime init   # writes hypit.runtime.json and selects it

# 3. Review the Profile: enable free local providers
#    endpoints:
#      image.opencv.local  -> @hypit/provider-image-opencv-local  (OpenCV image ops, needs python3)
#      media.local         -> @hypit/media-local                  (local media)
#      html.local          -> @hypit/provider-html-local           (Chromium capture/render)
#      # whisperx.local   -> @hypit/provider-whisperx-local       (needs local whisperx service)
#    HypiHub is included by default for hosted generation. Remove it and remove image/video
#    generation from your composition to stay entirely free/local.

# 4. Prepare and start the Runtime
hypit runtime up --endpoint image.opencv.local --endpoint media.local --endpoint html.local

# 5. Check an author source, then build
hypit check some-source.svml
hypit plan some-run.svrun
hypit build some-run.svrun --follow
```

## Free open-source providers (no key required)

| Endpoint | Package | What it does | Requirement |
| --- | --- | --- | --- |
| `image.opencv.local` | `@hypit/provider-image-opencv-local` | Image transform/compose | `python3` on PATH |
| `media.local` | `@hypit/media-local` | Media processing | built-in |
| `html.local` | `@hypit/provider-html-local` | Browser capture/render | Chromium (auto-install) |
| `whisperx.local` | `@hypit/provider-whisperx-local` | Word-level speech alignment | local whisperx service (Python) |

These declare `pricing.kind: "local"` and need no credentials. Use `hypit doctor` to verify.

## Paid/hosted providers (need accounts/API keys)

HypiHub (recommended hosted), HiAPI, Pollo, BeatAPI, Monid, TokenDance for video/image
generation models; ElevenLabs/FishAudio/Mimo for speech. Connect with `hypit auth login <endpoint>`
after selecting a Runtime Profile. See [Models and Providers](guide/providers.md) and
[model and deployment services](guide/service-partners.md).

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
