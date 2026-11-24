# Steam Revenue Estimator

A Chrome extension (Manifest V3) that adds an estimated revenue panel above the purchase section on every Steam store game page.

## Setup

```sh
npm install
npm run build      # or `npm run watch` while developing
```

Then in Chrome:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder (the one with `manifest.json`).
3. Open any `store.steampowered.com/app/...` page.

After rebuilding, click the reload icon on the extension card, then refresh the Steam page.

## Tracking games

Click **+ Track** in the revenue box to save a game. Click it again (it then reads **✓ Tracked**) to remove it. **Dashboard** opens the extension's page, which shows:

- totals for all tracked games (combined gross, combined net, median gross per game)
- bar charts by game (top 15, with "Show all") and by genre (total or average per game), switchable between gross, net, copies and gross per month
- a sortable table, with **Export CSV** for spreadsheets

Tracked games are saved in `chrome.storage.local` as raw Steam data, not as finished estimates, so changing the settings recalculates the whole list. Visiting a tracked game's store page again refreshes its saved review count.

## Dev time and scope

Both are rough estimates; Steam doesn't publish either one.

- **Page → launch**: time from the game's Steam page being created to its first launch, including Early Access. Steam hands out app IDs in order, so `src/dev-time.ts` holds a table of app IDs and approximate registration dates (built from about 22,000 sampled apps) and interpolates between them. Developers usually create the page partway through development, so this is a **minimum** development time. Early Access time is shown separately (`+ 14 mo EA`, or `EA` if the game is still in Early Access). If Steam has no record of an earlier Early Access launch, the first review date is used instead.
- **Scope** (Small / Medium / Large): points from store-page signals, max 9 (`src/scope.ts`): price (up to +2), install size (up to +2), 10+ languages, voiced in 3+ languages, 50+ achievements, multiplayer, and a publisher separate from the developer (+1 each). Small is 0–2, Medium 3–4, Large 5+. Hover over a Scope cell to see which signals counted.

Games tracked before these columns existed show "—" until you revisit their store page.

## Your data

Tracked games are stored in `chrome.storage.local`. Reloading, rebuilding, Chrome updates and clearing browsing data all leave them in place. Removing the extension deletes them. The limit is 10 MB, and each game takes about 550 bytes.

The **Your data** card on the dashboard downloads a JSON backup (tracked games plus settings) and restores from one. Restoring merges into your current list: when a game is on both sides, the more recently updated copy wins, and nothing is removed. **Clear all tracked games…** empties the list (after a confirmation), so you can back up, clear, and restore a different dataset.

## Sharing the dashboard

**Download shareable page (HTML)** in the **Your data** card saves the dashboard as a single HTML file with your current list and settings built in. Anyone can open it in a browser without the extension, and it works the same way: charts, sorting, column toggles, settings, CSV export, backup and restore. It uses the extension's own page and scripts (`src/share.ts` inlines them), plus a small stand-in for `chrome.storage` that keeps a viewer's changes in their own browser. **Reset to original** at the top returns to the snapshot. The game images load from Steam, so they need an internet connection.

## How the estimate works

1. **Reviews**: total reviews in all languages, from Steam's `IStoreBrowseService/GetItems` API (fetched by the background script, since that API doesn't allow requests from store pages). If that request fails, it falls back to the review count shown on the page. That count only covers your language, so confidence drops to Low.
2. **Copies sold** = reviews × copies-per-review (default 30–60, the "Boxleiter number"). The multiplier is scaled up for older games: ×1.6 before 2014, ×1.3 before 2017, ×1.1 before 2020.
3. **Gross** = copies × USD list price × realized-price ratio (default 60%, which covers discounts, bundles and regional pricing).
4. **Net to developer** = gross minus refunds (8%) and tax/VAT (10%), then Steam's tiered cut: 30%, 25% above $10M, 20% above $50M.
5. **Avg gross / month** = gross ÷ months since release.

No estimate is shown for free-to-play games, unreleased games, or games with no reviews or no USD price.

All of the multipliers and percentages above can be changed in the extension's options page (the **Dashboard** link on the widget). If you know real sales numbers for a few games, adjust them until the widget matches.

## Files

- `src/settings.ts`: tunable parameters, their defaults, and storage
- `src/estimator.ts`: the estimate math (no DOM or network code)
- `src/steam-api.ts`: Steam data fetching and date parsing
- `src/content.ts`: builds the widget and inserts it into the store page
- `src/ui.ts`: number formatting and DOM helpers used by both pages
- `src/tracking.ts`: saving and loading tracked games
- `src/backup.ts`: creating and validating backup files
- `src/dev-time.ts`: app ID to registration date table and the Page → launch estimate
- `src/scope.ts`: the Scope rating
- `src/share.ts`: builds the standalone shareable HTML page
- `src/dashboard.ts`: dashboard totals, chart, table and CSV export
- `src/options.ts`, `options.html`: the dashboard and settings page
- `src/background.ts`: opens the settings page when the widget's link is clicked

## License

[MIT](LICENSE). Not affiliated with or endorsed by Valve Corporation. Steam is a trademark of Valve Corporation.
