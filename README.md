# Lab Library

A browser-based research inventory and experiment checkout at **https://vubio.github.io/Lablibrary/**.

## What it does

- One shared schema for cell lines, antibodies, probes, chemicals, and custom categories.
- Category-aware field ordering and suggestions from previous items.
- Click-to-edit table cells, custom fields, versioning by case-insensitive item name, and collapsed histories.
- Experiment checkout defaults to the newest version, with a picker for earlier versions.
- Category-grouped lab-note tables, per-category remembered column choices, drag-to-order rows/tables, and rich-text clipboard formatting.
- CSV/TSV import, CSV export, and complete JSON backups.
- GitHub API persistence for cross-device use, with browser-local drafts and safe detection of simultaneous conflicting edits.

## One-time deployment

1. In the GitHub repository, open **Settings → Pages**.
2. Under *Build and deployment*, choose **GitHub Actions** as the source.
3. Open **Actions → Deploy Lab Library to GitHub Pages** and run the workflow if it has not run automatically.
4. Visit `https://vubio.github.io/Lablibrary/`.

### Direct GitHub database

All data is saved in `data/library.json` on the `main` branch. The browser reads the latest file directly from the GitHub API; it does **not** use a third-party database. The repository is public, so **all records committed here are public**, including notes and storage locations. Never store secrets, patient data, confidential protocols, or unpublished sensitive work in it.

To enable saving, open **GitHub sync settings** inside the app and enter a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with access only to `vubio/Lablibrary` and **Contents: Read and write**. Tokens are retained in *sessionStorage* for the current browser tab session, never committed to GitHub. Do not place them in source code or database fields.

Edits are immediately backed up in this browser and uploaded after a short debounce. Simultaneous non-overlapping edits can merge. Conflicting edits to the same row are stopped so nothing is silently overwritten; export a JSON backup and reconcile them before continuing.

## Development

The project uses plain HTML, CSS and JavaScript modules—no build step or package installation. For local development, serve the directory with any static HTTP server and open `index.html` (ES modules require HTTP, not a local `file://` URL).

The JSON format is versioned (`schemaVersion: 1`) and keeps item data separate from checkout presentation preferences. `enteredAt` is immutable when an existing record is edited; a copied version gets a new timestamp and ID.
