# Reception Fridge

A record of who takes what from the reception fridge, for the **Lighthouse Group, Swakopmund**.
One fridge, one person keeping the records, and the employees who take from it.

**Open it:** <https://erastusm.github.io/fridge-stock/>

## What it does

- **Take** — tap the person, tap what they took (+ / −), *Save*: "Erastus took 2 × Coke 330ml".
  Several items save together. *Undo* right after saving, or later from *Recently taken* with a
  reason; an undone entry stays in the history, struck through, and the stock goes back up.
  *Earlier?* records something taken before now.
- **Stock** — what is in the fridge and what it is worth. *Restock* when you put drinks in,
  *Count* to correct the number to what is really there (the difference is noted), and a
  "Buy more" line for anything low or out. Each item has a price (or none) and a low-stock level.
- **People** — the employees, with this month's items and total. Someone who leaves is ticked off,
  not deleted, so their history stays.
- **Report** — the monthly report: per person (what they took, every take with its date, the
  total in N$) and per item. *Print / PDF* (optionally one person per page) and CSV for Excel.
  The month is the calendar month, or e.g. the 16th to the 15th (Settings).
- The price is copied onto each take, so a later price change never alters a past month.

## Where the records are kept

On the device it is used on (the reception computer or tablet), in the browser. Nothing is sent
anywhere. **Settings → Download backup** saves everything to a file (keep it on OneDrive); the
app reminds you when there has been no backup for a month. *Restore a backup* moves the records
to another computer. Use one device and one browser for the real records.

*Settings → Load sample data* fills it with five people and nine drinks to try it out.

## Develop

Needs Node 22+.

```bash
npm install
npm run dev     # http://127.0.0.1:5180
npm test        # the rules: takes, undo, stock, months, report totals, CSV, backups
npm run build   # web/dist
```

The rules live in `web/src/model.ts` (pure functions, tested in `model.spec.ts`); the screens are
`web/src/*Tab.tsx`. Every push to `main` publishes to GitHub Pages
(`.github/workflows/pages.yml`).

The earlier multi-restaurant version (server, database, fridge tablets with PINs) is kept on the
`multi-venue` branch.
