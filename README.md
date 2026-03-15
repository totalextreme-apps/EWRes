# EWR Editing Suite

EWR Editing Suite is a cross-platform desktop editor for **Extreme Warfare Revenge 4.2** data files and save files, built with **Tauri + Vite + React + TypeScript**.

The goal of this project is simple: make EWR database and save editing faster, cleaner, and safer, while staying as close to native EWR behavior as possible.

This project is not meant to be a vague “inspired by EWR” editor. It is being built specifically around the structure, limits, quirks, and workflows of **real EWR 4.2 `.dat` files** and save-game files.

---

## What EWR Editing Suite Is

EWR Editing Suite is a modern desktop application for viewing, editing, and writing EWR 4.2 files through a consistent interface.

It is designed to help mod makers and save editors work with:

- base database files from the `DATA` folder
- in-progress save-game files
- external CSV workflows
- bulk editing workflows
- record creation / copying / deletion
- save-aware repair and utility tools where appropriate

The application uses a consistent editor pattern across modules:

- **left panel** for file controls, search, sort, filters, and record navigation
- **right panel** for record details and editing
- reusable card-based layouts
- shared import/export and multi-delete workflows where supported

---

## Project Goals

The project has been built around a few core principles:

### 1. Match EWR behavior as closely as possible
Wherever practical, file parsing and writing is based on verified record structures and live EWR behavior, not assumptions.

### 2. Support both DATA and save-game editing
Some values only make sense in save files. The editor distinguishes between base database editing and save-aware editing instead of pretending they are the same thing.

### 3. Reduce modding friction
The app is built to replace repetitive native-editor work with faster, more practical workflows:
searching, sorting, batch editing, external CSV editing, copy-record flows, and utility helpers.

### 4. Preserve data safely
Unknown or unverified fields should be preserved, not casually overwritten. Save-aware tools are intentionally narrow where mappings are not fully proven.

---

## Implemented Editors and Tools

The project currently includes the following major modules:

- Wrestlers Editor
- Promotions Editor
- Sponsors Editor
- Staff Editor
- Alter Egos Editor
- Relationships Editor
- Teams / Tag Teams Editor
- Television Editor
- TV Networks Editor
- Events Editor
- Game Info Editor
- Cranky Vince Rule Generator / Session System

---

## Current Feature Highlights

### Wrestlers Editor
The Wrestlers Editor is one of the most developed modules in the suite and includes:

- detailed wrestler profile editing
- search, sort, filters, and record navigation
- multi-delete
- external editing / CSV workflows
- save-aware contract/status utility section
- hidden save-stat visibility where verified
- read-only relationship, championships, and team context displays
- skills analysis tools and visualizations

Recent work in this area also focused on making save-only fields safer and more accurate by narrowing edits to the selected worker rather than allowing broad unintended writes.

---

### Promotions Editor
The Promotions Editor supports:

- promotion identity and settings editing
- linked context from related files
- logo and banner preview/load support
- workspace-aware folder handling for image assets
- copy/add/delete style record flows
- import/export workflows where supported

Special care has gone into making asset folder handling work correctly with both DATA-folder workflows and save-based workflows.

---

### Sponsors Editor
The Sponsors Editor supports:
- record browsing and editing
- sorting, search, and filters
- CSV import/export
- multi-delete and bulk workflows
- shared UI consistency with the rest of the suite

---

### Staff Editor
The Staff Editor includes:
- detailed record editing
- linked promotion handling
- search/filter/sort workflows
- consistency with the other core editors

---

### Alter Egos Editor
The Alter Egos Editor includes:
- full editor shell integration
- search/filter/sort
- record editing and management workflows
- consistency with the rest of the suite

---

### Relationships Editor
The Relationships Editor includes:
- relationship type editing
- external editing / CSV workflows
- search/filter/sort
- record and partner management
- consistency with the overall editor layout

---

### Teams / Tag Teams Editor
The Teams Editor includes:
- team composition editing
- team relationship management
- search/filter/sort
- copy/add/delete style workflows

---

### Television Editor
The Television Editor includes:
- show record editing
- network and related context handling
- save-file-aware contract-length support
- search/filter/sort
- shared editor behavior and styling

---

### TV Networks Editor
The TV Networks Editor includes:
- network details editing
- timeslot and production-related value editing
- search/filter/sort
- multi-delete and shared left-panel workflows

---

### Events Editor
The Events Editor includes:
- event record editing
- promotion/type/month filtering
- add/import/external editing support
- shared layout and left-panel behavior

---

### Game Info Editor
The Game Info Editor supports save-aware editing of important game metadata, including:

- Current Date
- Began date
- Joined date
- Username
- Save name
- proper save-folder handling

It also includes logic for syncing the known stale username text behavior that can appear across multiple save files.

---

### Cranky Vince Rule Generator
Cranky Vince is a save-aware rule/deck system built into the app.

It currently supports:

- explicit session handling
- create/load/delete saved sessions
- global custom rule saving
- built-in and custom rule viewing/editing/copy/hide/delete
- date-limited rule logic with `notBefore` / `notAfter`
- cleaner save/session folder structure
- promotion-context-driven deck behavior

This has grown from a simple idea into a real subsystem inside the editor.

---

## Major Accomplishments So Far

This project has already moved well beyond a prototype.

Major accomplishments include:

- building a consistent reusable editor shell across many EWR file types
- implementing real parser/writer support for multiple EWR `.dat` formats
- supporting both DATA-folder and save-folder workflows
- adding import/export and external CSV editing support in key modules
- implementing multi-delete across multiple editors
- building save-aware repair/fix tools where mappings are verified
- adding game-info editing for real save state fields
- building the Cranky Vince session system into the app
- improving editor UI consistency across modules
- identifying and correcting multiple write-safety issues during development

A large amount of work has gone into not just adding features, but correcting false assumptions, narrowing dangerous write paths, and keeping behavior grounded in verified file evidence.

---

## DATA Folder vs Save Folder

A key part of this project is that **DATA editing** and **save editing** are not treated as interchangeable.

### DATA workspace
A DATA workspace is intended for editing the base database.

### Save workspace
A save workspace is intended for editing in-progress game data.

Some controls are intentionally **save-only** and will be disabled in DATA mode by design.

That is not a bug. It is part of keeping the editor honest about what each field actually represents.

---

## External Editing and CSV Workflows

Several modules support import/export or external editing workflows.

These are intended to make bulk changes easier without forcing users to edit everything manually inside the app.

The project has also gone through work to ensure that when CSV import actually updates records, the editor correctly recognizes the file as changed so Save activates properly.

---

## Visual and UX Direction

The editor has been built around a consistent visual system:

- dark navy/black UI
- card-based sections
- left navigation / right detail workflow
- consistent button behavior
- record cards for navigation and multi-delete
- clearer section headers and grouped fields
- save-aware sections highlighted where appropriate

A lot of development time has gone into consistency, not just raw feature count.

---

## Current Development Status

**EWR Editing Suite is currently in beta-stage development.**

That means:

- it is already useful
- major editor modules exist and work
- the project is far beyond a mockup
- real workflows are being used and tested
- but it is still actively being hardened through real-world use

This is not positioned as “finished.” It is positioned as a serious working editor that is being tightened through testing.

---

## Important Warning

Always back up your files before editing.

That includes:
- `DATA` folder files
- save-game folders

This project is designed to preserve data carefully, but it is still a beta-stage editor for legacy binary file formats. You should never test on your only working copy of a database or save.

---

## Tech Stack

- **Tauri**
- **Vite**
- **React**
- **TypeScript**

---

## Why This Project Exists

Editing EWR data in the original tools is slow, fragmented, and limited.

This suite exists to give EWR modders and players a much better workflow without losing sight of how the game actually works.

The project is being built to save time, reduce repetitive work, support more advanced editing workflows, and make large-scale EWR database work practical in a modern desktop app.

---

## Beta Testing Focus

Current beta testing is especially valuable around:

- save vs DATA behavior
- CSV import/export workflows
- single-record vs unintended mass-write safety
- UI consistency and editor ergonomics
- Windows and macOS packaging behavior
- file compatibility with real EWR usage

---

## Feedback

If you test the app and find a bug, useful feedback should include:

- which editor you were using
- whether you loaded a DATA folder or save folder
- what action you took
- what you expected to happen
- what actually happened
- whether the edited file still opened in EWR
- screenshots or source files if relevant

---

## Project Name

**EWR Editing Suite**

A cross-platform editor built specifically for **Extreme Warfare Revenge 4.2** data and save files.


# Tauri + React + Typescript

This template should help get you started developing with Tauri, React and Typescript in Vite.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)


