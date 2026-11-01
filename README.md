# Trip Tally — split travel costs offline

A holiday-expense splitter for a travel group. Log every receipt as you go, in whatever currency you paid, and Trip Tally works out who owes whom. It runs entirely on your phone: no account, no server, no signal needed.

## What it does

- **Trips** with your travel buddies (add or remove people any time)
- **Not everything is split by the whole group.** Every expense asks *who's in on this?*:
  - **Equally** among just the people you tick (with Everyone / Clear shortcuts)
  - **By item**: enter a receipt's line items and tap who had each one. Tax, service charge and tips (or discounts) are spread in proportion to what each person ordered
  - **Amounts**, **%** or **Shares** for anything else
- **Reads your receipts**: scan or drop a receipt photo and Trip Tally fills in the total, currency, date, shop name and category, and offers to split by the line items it found (tax, service charge and tips are spread in proportion). It only asks you for what it couldn't read, and never overwrites anything you've typed. Reading happens on the phone — the receipt reader (tesseract.js, ~10 MB) downloads once, then works offline. Supports English plus up to two of Japanese, Chinese, Korean, Thai, Vietnamese and Malay/Indonesian, picked automatically from where you are and the trip's currencies
- **Where you spent**: the GPS position in a receipt photo is used when present. Optionally, a **location trail** records where you are while the app is open, so receipts you enter later in the day are tagged with where you were at the time printed on them. Each day can show an offline route sketch of the trail and your spending stops, with a link to open it in Google Maps. (Browsers don't allow tracking while a web app is closed, so the trail covers the times the app is open.)
- **Currency follows you**: when your phone's time zone is in another country, new expenses default to that country's currency
- **Receipt photos**: snap, pick, drag & drop or paste one or more photos per expense. Drop a photo anywhere on a trip to start a new expense with it attached. Photos are downscaled, stored on the phone, and open full screen when tapped
- **Multi-currency**: when you start a trip, pick the countries you're travelling to and your home currency. The currency picker on each expense shows **📍 Near you** (currencies that could apply where you are — worked out offline from your phone's location and time zone, listing neighbours too when you're near a border), **This trip** (your destinations and home currency) and a searchable list of all currencies. Enter the rate you actually got, typed either way round (`1 SGD = 115 JPY` or `1 JPY = 0.0087 SGD`); the Rates tab lists your destination currencies so you can set rates before you go. Each expense keeps its own rate, and the Rates tab can re-value all items in a currency
- **Categories** (food, stay, transport, activities, shopping, other) and a trip summary showing spend by category, who paid what and each person's share of costs
- **Settle up** with the fewest payments; one tap records a payment
- **Quick maths** in amount fields: `45.50+12+8.2`
- **Export** a trip to CSV, share a text summary, and back up / restore everything (including receipt photos) as one JSON file

## Where the data lives

Trips, transactions and the location trail are in the browser's `localStorage`; receipt photos are in IndexedDB. Nothing leaves the device — receipts are read on the phone, and only the reader's program files are downloaded. The app asks the browser for persistent storage, but clearing site data erases everything, so use **Back up to file** after a trip.

## Offline

A service worker caches the app on first visit. After that it opens and works with no connection. Add it to your home screen:

- **iPhone (Safari):** Share → Add to Home Screen
- **Android (Chrome):** ⋮ → Install app

## Run locally

Plain HTML/CSS/JS, no build step:

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Hosting

GitHub Pages: Settings → Pages → Deploy from branch → `main` / root. Open the Pages URL on your phone once while online, then install it.
