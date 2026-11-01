# Tally — split bills offline

A Splitwise-style bill splitter that runs entirely on your phone. No account, no server, no internet needed after the first load.

## What it does

- **Groups** for trips, flats or dinners, with as many people as you like
- **Expenses** paid by anyone, split four ways: equally, by exact amounts, by percentage, or by shares
- **Multi-currency** — every group has a main currency; log each expense in whatever currency you paid in and enter the exchange rate you actually got. Rates can be typed either way round (`1 JPY = 0.0087 SGD` or `1 SGD = 115 JPY`)
- **Rates are snapshotted** on each expense, so later rate changes don't silently rewrite history (there's a "use for all" button if you do want to re-value)
- **Balances and settle-up** — shows who owes whom and the fewest payments to clear everything; one tap records a payment
- **Quick maths** in the amount field: type `45.50+12+8.2`
- **Export** a group to CSV, share a plain-text summary, and back up / restore everything as a JSON file

## Where the data lives

All transactions are stored in the browser's `localStorage` on the device. Nothing is sent anywhere. The app asks the browser for persistent storage so it won't be auto-cleared, but clearing site data or uninstalling the browser will erase it — use **Back up to file** now and then.

## Offline

A service worker caches the app on first visit. After that it opens and works with no connection. Add it to your home screen:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

## Run locally

It's plain HTML/CSS/JS with no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

(Service workers need `http://localhost` or `https://`, not `file://`.)

## Hosting

Turn on GitHub Pages for this repo (Settings → Pages → Deploy from branch → `main` / root) and open the Pages URL on your phone once while online.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `app.js` | All logic: storage, split maths, balances, UI |
| `styles.css` | Styles (light and dark) |
| `sw.js` | Offline cache |
| `manifest.webmanifest`, `icon*` | Install-to-home-screen metadata |
