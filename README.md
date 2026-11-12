# Fridge Stock

Fridge stock tracking for the **Lighthouse group, Swakopmund**: several restaurants, several
fridges each, a tablet at every fridge. When something is taken out, put in, thrown away or moved,
the stock updates immediately, with who did it and when.

## How it works

- **Tablet at each fridge** (`/kiosk`). Staff tap an item → *Take out / Put in / Throw away / Move to…*
  → quantity → their PIN. The PIN records who did it. Items show **LOW / OUT** and
  **USE SOON / EXPIRED** flags, and the oldest stock is always taken first (FIFO by use-by date).
- **Manage app** (`/manage`) for managers (their own restaurant) and owners (all restaurants):
  dashboard with the reorder list and what to use or bin first, minimum/par levels per fridge,
  stock counts, full history with CSV export, usage & waste reports, staff and PINs, tablet pairing.
- **Staff accounts.** Give an item a selling price and every take of it is charged to the person
  whose PIN was used, at the price on that day (a later price change never rewrites history).
  Record payments (cash, EFT, salary deduction, card, or a credit to correct a charge); a mistaken
  payment is voided with a reason, never deleted. **Statements** run 16th–15th by default (set per
  venue), carry the balance forward, and print or save as PDF, one person per page.
- **Receive & record** for the back office: deliveries with their supplier, and takes or waste
  entered for someone who forgot the tablet, marked "entered by" in the history.

**Try it on a phone:** <https://erastusm.github.io/fridge-stock/> — a demo build with sample data
that runs entirely in the browser (each device has its own copy; *Reset demo data* starts over).
The demo PINs are listed on its home page.

Stock is stored as **batches** (quantity + use-by date). Every change is one database transaction
that locks the fridge/item row, so two tablets can never both take the last item; a database
`CHECK` keeps stock from ever going negative. Dates and "today" use the restaurant's time zone
(`Africa/Windhoek`).

## Run it locally

Needs Node 22+ and Docker.

```bash
npm install
cp server/.env.example server/.env
npm run setup     # starts Postgres (127.0.0.1:55480), migrates, seeds placeholder venues
npm run dev       # API on :4100, web on http://127.0.0.1:5180
```

The seed creates two **placeholder** venues with random logins and PINs, written to
`server/prisma/seed-credentials.md` (git-ignored). Replace them with the real venues, fridges and
items in the manage app, or reset with `npm run db:seed -w server -- --reset`.

To try a real tablet on the same Wi-Fi: `npm run dev -w web -- --host`.

## Set up a fridge tablet

1. In **Manage → Tablets**, choose the fridge and *Create code* (6 digits, single use, 15 minutes).
2. On the tablet, open the site, choose **Fridge tablet**, type the code.
3. Add it to the home screen (it installs as an app). Unpair it in Manage if it is lost.

## Tests

```bash
npm test          # server: domain + API tests against fridge_test; web: offline queue + formatting
```

The API tests include two tablets racing for the last item, PIN lockout, cross-restaurant access,
idempotent retries, transfers keeping use-by dates, and stock counts.

## Demo build

`npm run build:demo -w web` (Vite `--mode demo`) produces `web/dist-demo/`: the same app with the API
answered by an in-browser stand-in (`web/src/demo/demoServer.ts`) that reuses the server's FIFO,
status, date and money rules. It is published to GitHub Pages by `.github/workflows/pages.yml` on
every push to `main`. It is for trying the screens, not for real records: PINs are kept in plain
text in the browser and there are no passwords.

## Production notes

- Set `JWT_SECRET` and `PIN_SECRET` to 32+ random characters (the server refuses to start otherwise),
  `DATABASE_URL`, `API_PORT`, and `HOST=0.0.0.0` behind a TLS reverse proxy that serves `web/dist` and
  forwards `/api` to the server.
- `npm run build`, then `npm run db:deploy -w server` and `npm start -w server`.
- If the Wi-Fi drops, a tablet keeps working: changes are stored on the tablet (with the PIN typed)
  and sent when the connection returns; the server re-checks each one.
