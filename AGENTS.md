# AGENTS.md

Guidance for coding agents working on this repository.

## Project Overview

This repository contains a Tampermonkey/Violentmonkey/Greasemonkey userscript for LINUX DO:

- `linuxdo-read-only-browse.user.js` is the main script.
- `README.md` is the user-facing documentation.
- `assets/panel-preview.svg` is the README preview image.

The script injects a floating control panel on `https://linux.do/*`, browses topics, tracks daily read/like counts, supports configurable breaks, and can optionally assist with main-post likes when the user enables it.

## Development Rules

- Keep the project dependency-free unless there is a strong reason.
- Prefer editing the userscript directly; this is not a bundled app.
- Keep changes compatible with common userscript managers.
- When changing behavior, update `README.md` if users need to know about it.
- When changing the panel UI, update `assets/panel-preview.svg` if the preview would become misleading.
- Keep persisted state backward compatible. New fields should be added to `DEFAULTS`.
- Do not wipe or rename existing storage keys unless explicitly requested.

## Safety And Interaction Boundaries

- Do not add comment, bookmark, follow, message, or reply automation unless explicitly requested and carefully scoped.
- Automatic likes must remain opt-in via the `自动点赞` control.
- Automatic likes should only target the main post and only after the configured threshold is met.
- Avoid duplicate likes by checking both page state and the local `autoLiked` record.
- Keep visible status messages for actions that affect the user's account.

## Versioning And Release

Every pushed userscript behavior change should increment the metadata version:

```js
// @version      0.3.1
```

The installed script updates from GitHub Raw through:

```js
// @downloadURL  https://raw.githubusercontent.com/baiya123/linuxdo-read-plugin/main/linuxdo-read-only-browse.user.js
// @updateURL    https://raw.githubusercontent.com/baiya123/linuxdo-read-plugin/main/linuxdo-read-only-browse.user.js
```

If `@version` is not bumped, userscript managers may not detect an update.

## Validation

Run this after JavaScript changes:

```powershell
node --check .\linuxdo-read-only-browse.user.js
```

For selector or page-structure changes, verify against real LINUX DO pages in Chrome when possible, especially:

- topic pages with reaction counters
- topic pages with only topic-map like counts
- topic pages with zero likes
- list pages such as `https://linux.do/latest`

## Git Workflow

- Check status before editing and before committing:

```powershell
git status --short --branch
```

- Keep commits focused and descriptive.
- Do not revert unrelated user changes.
- Push to `origin/main` when the user asks for GitHub updates.

## Style

- Use plain JavaScript and browser APIs.
- Keep comments sparse and useful.
- Use ASCII for code and documentation unless Chinese UI/user-facing text is needed.
- Match the existing naming and layout conventions.
