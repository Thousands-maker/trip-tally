# Trip Tally — split travel costs offline

A holiday-expense splitter for a travel group. Log every receipt as you go, in whatever currency you paid, and Trip Tally works out who owes whom. It runs entirely on your phone: no account, no server, no signal needed.

## What it does

- **Trips** with your travel buddies (add or remove people any time)
- **Not everything is split by the whole group.** Every expense asks *who's in on this?*:
  - **Equally** among just the people you tick (with Everyone / Clear shortcuts)
  - **By item**: enter a receipt's line items and tap who had each one. Tax, service charge and tips (or discounts) are spread in proportion to what each person ordered
  - **Amounts**, **%** or **Shares** for anything else
- **Receipt photos**: snap or pick one or more photos per expense. They're downscaled and stored on the phone, and tap to view full screen
- **Multi-currency**: each trip has a home currency. Log each expense in the currency you paid and enter the rate you actually got, typed either way round (`1 JPY = 0.0087 SGD` or `1 SGD = 115 JPY`). Each expense keeps its own rate, and the Rates tab can re-value all items in a currency
- **Categories** (food, stay, transport, activities, shopping, other) and a trip summary showing spend by category, who paid what and each person's share of costs
- **Settle up** with the fewest payments; one tap records a payment
- **Quick maths** in amount fields: `45.50+12+8.2`
- **Export** a trip to CSV, share a text summary, and back up / restore everything (including receipt photos) as one JSON file

## Where the data lives

Trips and transactions are in the browser's `localStorage`; receipt photos are in IndexedDB. Nothing leaves the device. The app asks the browser for persistent storage, but clearing site data erases everything, so use **Back up to file** after a trip.

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
