# Lab Library

A browser-based research inventory and experiment checkout at **https://vubio.github.io/Lablibrary/**.

## What it does

- One shared schema for cell lines, antibodies, probes, chemicals, and custom categories.
- Category-aware field ordering and suggestions from previous items.
- Click-to-edit table cells, custom fields, versioning by case-insensitive item name, and collapsed histories.
- Experiment checkout defaults to the newest version, with independent checkboxes for selecting additional or older versions of the same material. The main item checkbox clears all its selected versions when unchecked.
- **Save as new** always creates a separate named experiment record; **Update opened** explicitly overwrites only the currently open saved experiment. Open, update, or delete saved plans without affecting inventory rows.
- Remove a single material version directly in the lab-note preview via × beside its drag handle, without unchecking it in the picker; the control is excluded from clipboard output and updates only the working checkout until explicitly saved.
- Filter checkout items instantly using category chips or the same category sidebar as the library. The picker offers Edit and + Version buttons for each item, plus individual Edit controls for earlier versions, using the existing library dialog.
- Compare materials with multiple versions directly from the checkout picker. A compact popup shows every version but only fields whose saved values differ, using dates only to identify versions.
- Click any **All materials** column heading to sort ascending/descending (including categories, numbers, and dates). Search/filter and expand items without losing the chosen sort. **Copy current view** exports the table in its displayed order, including expanded version rows, as plain TSV plus simple 11-point HTML; the Actions column is excluded.
- Category-grouped lab-note tables, per-category remembered column choices, drag-to-order rows/tables, and smaller (9 pt) rich-text clipboard tables for OneNote.
- CSV/TSV import, CSV export, and complete JSON backups.
- GitHub API persistence for cross-device use, with browser-local drafts and safe detection of simultaneous conflicting edits.

## One-time deployment

1. In the GitHub repository, open **Settings → Pages**.
2. Under *Build and deployment*, choose **GitHub Actions** as the source.
3. Open **Actions → Deploy Lab Library to GitHub Pages** and run the workflow if it has not run automatically.
4. Visit `https://vubio.github.io/Lablibrary/`.

### Direct GitHub database

All inventory records, category preferences, and saved experiment checkout plans are saved in `data/library.json` on the `main` branch. The browser reads the latest file directly from the GitHub API; it does **not** use a third-party database. The repository is public, so **all records committed here are public**, including notes and storage locations. Never store secrets, patient data, confidential protocols, or unpublished sensitive work in it.

The website and committed library records are readable from any computer with internet access. **Edits made without GitHub connection are only saved to that browser**, not published to the shared repository. To enable cross-device saving, open **GitHub sync settings** inside the app and enter a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new) with access only to `vubio/Lablibrary` and **Contents: Read and write**. Tokens are retained in *sessionStorage* for the current browser tab session, never committed to GitHub. Do not place them in source code or database fields.

Edits are immediately backed up in this browser and uploaded after a short debounce when authenticated. A GitHub write token must be supplied separately on each computer/browser session where edits will be made. Saved checkouts preserve all selected inventory versions (including multiple versions of one material), category and row ordering, and visible-column choices; temporary preview cell edits and rich-text formatting are not preserved when reopening a saved plan. Simultaneous non-overlapping edits can merge. Conflicting edits to the same row are stopped so nothing is silently overwritten; export a JSON backup and reconcile them before continuing.

## Development

The project uses plain HTML, CSS and JavaScript modules—no build step or package installation. For local development, serve the directory with any static HTTP server and open `index.html` (ES modules require HTTP, not a local `file://` URL).

The JSON format is versioned (`schemaVersion: 1`) and keeps item data separate from checkout presentation preferences. `enteredAt` is immutable when an existing record is edited; a copied version gets a new timestamp and ID.
