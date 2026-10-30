# Dear Diarrhea

A local journal. It runs on your computer and never leaves it. Entries stay in `data/`, which is gitignored.

## Set up

1. Install [Python 3.10+](https://www.python.org/downloads/) and add it to PATH.
2. On Windows, double-click `journal.bat`. Anywhere else:

```
python -m pip install -r requirements.txt
python app.py
```

3. Open `http://127.0.0.1:7777` if the browser does not.
4. Set a pin (4–8 digits). It is asked on every launch.
5. Leave the terminal open. Close it to stop the app.

If the port is already in use, the app opens the existing window instead of starting a second one.

Desktop shortcut: point it at `journal.bat` and use `logo/logo.ico` as the icon.

## How to use

Open it and write. The page saves itself. Poke around if you wanna!

- write
- rating
- calendar and streak
- search
- photos
- on this day
- stats
- night mode
- lock
- export

## Data

- `data/journal.db` — entries, moods, pin
- `data/photos/` — pictures

Copy `data/` to back it up.

## Reset the pin

```
python app.py --reset-pin
```

## Tweaks

- Prompts: `TEMPLATES` in `static/app.js`
- Port: `PORT` in `app.py` (default 7777)
- Do not open a browser: `python app.py --no-browser`

## Credit

Made by Hayley~~ Contact me for any questions on hhanhn2002@gmail.com

Python · [Flask](https://flask.palletsprojects.com/) · SQLite · HTML · CSS · JavaScript · [Fraunces](https://fonts.google.com/specimen/Fraunces) · [Nunito](https://fonts.google.com/specimen/Nunito) · [Caveat](https://fonts.google.com/specimen/Caveat) · [Pixelify Sans](https://fonts.google.com/specimen/Pixelify+Sans)
