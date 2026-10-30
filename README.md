# Journal

A personal journal that runs locally on your laptop (Flask + SQLite).

## Run
Double-click **`journal.bat`**. The first run installs Flask, then opens `http://127.0.0.1:7777` in your browser.
Close the console window to stop it. You'll set a PIN the first time you open it.

Needs Python 3.10+ on PATH.

## Features
- Opens straight to today; autosaves while you type
- PIN lock on every launch (🔒 Lock button to lock manually)
- Several time-stamped entries per day, Markdown, templates, word counts
- Mood per day, mood chart and breakdown, writing streak
- Calendar (dots = written, colour = mood), "On this day" (1 month / 1+ years ago)
- Search, photo attachments, dark/light theme
- Export everything as a `.zip` of Markdown files + photos

## Where your stuff lives
Everything is in `data/`: `journal.db` plus `data/photos/`. To back up, copy that folder.
`data/` is in `.gitignore`, so pushing the repo to GitHub won't upload your journal.

## Forgot your PIN?
```
python app.py --reset-pin
```

## Customise
- Templates: `TEMPLATES` at the top of `static/app.js`
- Port: `PORT` in `app.py`
