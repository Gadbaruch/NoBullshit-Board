# NoBullshit Board

Minimal multi-project kanban board for fast personal task tracking.

Live site:
- [https://gadbaruch.github.io/NoBullshit-Board/](https://gadbaruch.github.io/NoBullshit-Board/)

## What It Does

- Multiple projects in a single horizontal board
- Per-project task ordering by drag and drop
- `To do` / `Done` toggle per project
- Project goals
- Task deadlines with relative labels
- Emoji tags
- Multi-select tasks for bulk move / done / delete
- Import / export sheet
- Local board recovery from browser storage

## Tech

No framework and no build step.

- `index.html`
- `styles.css`
- `app.js`

Everything runs in the browser and saves to `localStorage`.

## Run Locally

Open `index.html` in a browser.

Or serve it locally:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Data Storage

- Board data is stored locally in the browser
- Different boards are stored as separate local instances
- Board name is reflected in the URL hash
- Clearing browser storage will remove local data

## Project Structure

```text
index.html   UI structure
styles.css   layout and visual design
app.js       app state, drag/drop, import/export, interactions
```

## Publish

This repo is set up to publish via GitHub Pages from `main`.

Site URL:
- [https://gadbaruch.github.io/NoBullshit-Board/](https://gadbaruch.github.io/NoBullshit-Board/)

## Contributing

If you want other people to contribute:

1. Fork the repo
2. Create a branch
3. Make changes
4. Open a pull request

## Open Source Checklist

To make this properly open source, add:

1. A license
2. A README
3. Optional: `CONTRIBUTING.md`
4. Optional: issue / PR templates

Without a license, people can view the code, but legally they do **not** have clear permission to reuse, modify, or redistribute it.
