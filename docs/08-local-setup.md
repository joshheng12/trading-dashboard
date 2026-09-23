# Local development on Windows

## Requirements

- Git (already available on the machine during setup).
- Node.js satisfying `^22.18.0 || >=24.12.0`, with npm. Node 24 LTS is a suitable choice.
- A Finnhub API key for search, quotes, and streaming.
- Alpaca **paper-account** API key ID and secret for charts, portfolio, and paper orders.
- An editor; the repo recommends the Vue Official, ESLint, Prettier, and Vitest extensions.

No database, Docker, or Netlify account is required for local development.

## First run

After installing Node, restart your editor/terminal so it sees the updated PATH.
Open PowerShell in the repository root and run:

```powershell
node --version
npm.cmd --version
npm.cmd ci
```

If `.env.local` does not exist, copy the template (do not overwrite an existing file):

```powershell
Copy-Item .env.example .env.local
```

Fill in `.env.local` locally:

| Variable | Value |
| --- | --- |
| `FINNHUB_API_KEY` | Your Finnhub key for backend requests |
| `VITE_FINNHUB_API_KEY` | Your Finnhub key for browser streaming; the same key can be used |
| `ALPACA_API_KEY_ID` | Your Alpaca paper-account API key ID |
| `ALPACA_API_SECRET_KEY` | Matching paper-account secret |
| `APP_PASSCODE` | A strong passcode you choose; enter this in the app's sign-in dialog |
| `SESSION_SECRET` | A long random signing secret, distinct from the passcode |

The setup assistant created `.env.local` and generated `SESSION_SECRET` on this machine.
For a fresh clone, generate a secret with `node -e "console.log(require('node:crypto').randomBytes(48).toString('base64'))"` and paste it into that field.

Keep the default Alpaca paper host. The browser streaming key is intentionally client-visible;
Alpaca keys and the session secret belong only in server environment variables. `.env.local`
is ignored by Git. Do not paste your credentials into source files or commit them.

```powershell
npm.cmd run dev
```

Open http://localhost:5173. The API runs at http://localhost:8787.
http://localhost:5173/api/health should return `{"ok":true}` through the Vite proxy.
Restart the development command after changing environment variables. Press Ctrl+C to stop.

The app can start without provider keys, but market data and portfolio requests will fail.
Sign-in requires both `APP_PASSCODE` and `SESSION_SECRET`. Order placement and cancellation
require sign-in; account and market-data reads do not.

## Working on the code

- `src/views/`: pages; `src/components/`: reusable UI.
- `src/stores/`: Pinia state; `src/services/`: frontend API clients.
- `server/app.ts`: backend routes.
- `server/alpaca.ts`: candles, account, positions, and orders.
- `server/alpacaClient.ts`: Alpaca transport and credential handling.
- `docs/`: architecture, design system, and project decisions.

Before committing:

```powershell
npm.cmd run build
npm.cmd run test:unit -- --run
```

`npm.cmd run lint` also runs the linters, but applies fixes.
Use `npm.cmd` on Windows if PowerShell blocks the `npm.ps1` shim.
`npm.cmd run preview` serves the production frontend only; it does not start the API.
Use `npm.cmd run dev` for the full local application.