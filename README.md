# Games

Multiplayer board games as an installable PWA, backed by a single Railway
service (Vite + React client, Express + socket.io API, Postgres). First game:
**Splendor**. New games slot into `src/shared/games.ts`.

## Architecture

```
src/
  shared/            # types + game engines shared by client and server
    types.ts         # platform types (users, games, invites)
    games.ts         # game-type → rules-module registry
    splendor/        # Splendor data + server-authoritative engine
  api/               # Express + socket.io + Postgres (compiled to dist/server)
    server.ts        # entrypoint: REST + realtime + static SPA
    auth.ts          # Google OAuth + session cookies
    store.ts         # Postgres schema + data access
    routes.ts        # /api/games, /api/invites, /api/users/search
    realtime.ts      # socket.io: per-game rooms, per-player state views
  client/            # Vite React PWA (built to dist/)
    components/      # Login, Lobby, GameView, InvitePanel, splendor/*
```

The server is **authoritative**: every move is validated by the game engine in
`src/shared`. Clients render the redacted state view they receive and dispatch
actions; illegal moves come back as `400` with a message. State updates fan out
over socket.io to everyone watching a game (each socket gets its own redacted
view, so opponents never see your reserved cards or the deck order).

## Local development

Dev runs on plain HTTP at **http://127.0.0.1:4567**, with the Vite client
proxying API requests to the local Express backend.

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in `DATABASE_URL` (any Postgres)
   and `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
3. Start local development:
   `npm run dev`
4. Open http://127.0.0.1:4567 and sign in.

`npm run typecheck` checks both the client and API tsconfigs. `npm run build`
produces `dist/` (client) and `dist/server/` (API); `npm start` serves both.

See [DEPLOY.md](./DEPLOY.md) for Railway + Google OAuth setup.

## Sound

Every move has a sound — chips click, lift and clack into trays, cards slide
and land, nobles chime, a rainbow twinkles — synthesised on the fly with the
Web Audio API in `src/client/sfx.ts`, so there are no audio files to ship. Each
effect has several variants, picked at random and never repeated back to back.
Players can switch sound off under **Settings → Sound**.

## Dev tools (admin only)

Signed in as the admin (`GAMES_ADMIN_EMAIL`), two unlisted pages help with
tuning. Neither is linked from the app; type the address in:

- `/dev/animations` — plays every Splendor animation back to back (also under
  Settings → Dev tools): token flights, card buy/reserve, noble visits, single,
  double and triple rainbows, a replay of missed moves, turn changes, the final
  round and game over.
- `/dev/sounds` — a soundboard: every sound effect, when the game plays it, and
  a button for each of its variants, plus "Play all" to hear them in sequence.

## Adding a game

1. Add the type to `GameType` in `src/shared/types.ts`.
2. Create `src/shared/<game>/` with a state type, data, and an engine exposing
   `createInitialState`, `applyAction`, `viewFor`, `winnerId`.
3. Register it in `src/shared/games.ts`.
4. Add a board component under `src/client/components/<game>/` and branch on
   `detail.type` in `GameView`.
