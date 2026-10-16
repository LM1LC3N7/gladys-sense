# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads a **Sense energy monitor** (United States and Canada) through the
undocumented cloud API of the Sense app (`api.sense.com`, e-mail + password,
two-factor code when the account asks for one) and its real-time WebSocket
(`clientrt.sense.com`). The logic is ported from scottbonline/sense
(sense-energy, MIT, see THIRD_PARTY_NOTICES.md). Unofficial: not affiliated
with Sense Labs. Sibling of `gladys-tibber`.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "two-factor"   # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        SenseApp: session, discovery, trends, energy, real time, actions
src/sense/api.js                  sign-in, two-factor code, token renewal, authenticated GETs
src/sense/live.js                 the real-time WebSocket (backoff + jitter, silence watchdog)
src/sense/msgpack.js              MessagePack decoder for the feed frames
src/sense/model.js                Sense answers -> plain values (pure)
src/devices.js                    the devices, feature keys, states (pure)
src/config.js                     DEFAULTS (mirror the manifest defaults) + normalization
src/constants.js                  endpoints, pacing, manifest keys
src/i18n.js                       runtime texts (en/fr)
src/http.js                       the only HTTP access (errors sorted into codes)
gladys-assistant-integration.json manifest: name, config_schema, actions, image...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Sense keys are forever too**: the external ids `monitor:<monitor id>` and
  `appliance:<monitor id>_<Sense device id>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys of `src/constants.js` and the config key
  `sense_session`.
- **Be polite with Sense**: one WebSocket only, reconnected with backoff and
  jitter; trends every 15 min, devices every 6 h; one token renewal per 5 min
  at most; never sign in with the password in a loop; a 429 pauses every call.
- **Secrets**: never log the e-mail, the password, a token or a URL of the
  feed (the token is in its query). Errors of `src/http.js` carry no URL nor
  body.
- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, actions): change both sides together.
- **User-facing text** is bilingual (English and French): action messages,
  manifest texts, and `docs/en.md` / `docs/fr.md`, kept in sync.
- **Encoding.** Files are UTF-8 without BOM; `test/encoding.test.js` refuses
  mojibake. Write them with an editor, never with PowerShell `Set-Content`.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
