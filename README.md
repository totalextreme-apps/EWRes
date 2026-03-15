# EWR Editing Suite

EWR Editing Suite is a cross-platform desktop editor for **Extreme Warfare Revenge 4.2** data and save files.

It is built with **Tauri + Vite + React + TypeScript** and is designed to make editing faster, safer, and more consistent while staying as close to native EWR behavior as possible.

## Beta scope
This beta currently includes editors for:
- Wrestlers
- Promotions
- Sponsors
- Staff
- Alter Egos
- Relationships
- Teams / Tag Teams
- Television
- TV Networks
- Events
- Game Info
- Cranky Vince

## Important warning
This is a **beta** build.

Always back up your files before editing:
- your `DATA` folder files
- your save-game folder files

Do not test this build on your only working copy of a database or save.

## DATA folder vs Save folder
Some fields and tools are intentionally limited depending on what kind of workspace you load.

- **DATA folder workspace** = base database editing
- **Save folder workspace** = in-progress game editing

Some controls are save-only and will be disabled in DATA mode on purpose.

## Current beta highlights
- Consistent left-panel / right-panel editing workflow across major editors
- External CSV editing support in supported modules
- Multi-delete support across implemented editors
- Save-aware tools where appropriate
- Game Info editor support for key save-file fields
- Cranky Vince session handling and save integration
- Wrestlers save-file contract/status fix tools limited to selected-worker behavior
- Television save-file contract length support

## Building locally
### Requirements
- Node.js 20+
- Rust toolchain
- Tauri CLI prerequisites for your platform

### Install
```bash
npm install
```

### Run in development
```bash
npm run tauri dev
```

### Build
```bash
npm run tauri build
```

## GitHub Releases
This repository is set up to use **GitHub Actions** to build unsigned beta releases for macOS and Windows when you push a version tag like:

```bash
git tag v0.9.0-beta.1
git push origin v0.9.0-beta.1
```

The workflow will build release artifacts and attach them to a GitHub Release.

## Reporting bugs
If you hit a bug, report:
- which editor you were using
- whether you loaded a DATA folder or save folder
- what you did step by step
- what you expected to happen
- what actually happened
- whether the file still opens in EWR
- screenshots if useful
- the affected file if you are comfortable sharing it
