# Cloud Chess Studio (Universal Supabase)

This build does **not** require each user to create a Supabase Auth account.
Users create an in-app player profile (username/password), and all data is stored in one shared Supabase project.

## Stack

- Lichess board UI: `@lichess-org/chessground`
- Lichess-compatible chess logic: `chessops` (local bundled module in `vendor/chessops.bundle.js`)
- Lichess media assets from the `lila` repository (2D + 3D pieces, boards, sounds)
- Supabase Postgres + Realtime (single universal project)

## Fixed Supabase project

- API URL: `https://zunmeiakbtqlhssjkelt.supabase.co`
- Publishable anon key: configured in [`supabase-client.js`](C:/Users/prezv/Documents/Coding/chess/v3/supabase-client.js)

## Files

- `login.html` and `signup.html`: creative player login/signup pages
- `auth.css`, `auth.js`: in-app profile auth flow (no Supabase Auth)
- `supabase-client.js`: fixed Supabase client + player session token handling
- `index.html`, `styles.css`, `app.js`: main chess app
- `vendor/chessops.bundle.js`: browser-safe chessops bundle (fixes bare module issues)
- `supabase.sql`: universal schema, RPC login/signup functions, token-based RLS

## First-time setup

1. Open Supabase SQL Editor.
2. Run `supabase.sql`.
3. Serve this folder over HTTP:

```bash
python -m http.server 8080
```

4. Open `http://localhost:8080/signup.html` and create a player.
5. Login at `http://localhost:8080/login.html`.

## Data model

- `profiles`: app player account (`username`, `display_name`, `password_hash`, `owner_token`)
- `user_settings`: per-player board preferences
- `chess_games`: per-player cloud games

RLS is scoped by an `x-player-token` request header managed by the app.

## Notes

- `supabase.sql` drops old auth-based tables for a clean migration.
- Human promotions use the in-app selection dialog; engine promotions default to queen.
- Supabase Auth providers are not required for this flow.
