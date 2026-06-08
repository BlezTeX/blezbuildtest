# Banditimo v0.0.7 Drop-In Build

This version is made to be easy to upload to GitHub/Railway.

## Important

This version does NOT need a `public` folder.
This version does NOT need a `data` folder.

Just upload these root files:

```txt
index.html
style.css
game.js
server.js
package.json
start.bat
README.txt
.gitignore
```

The database file `banditimo-db.json` is created automatically when the server starts.

## Local LAN test

1. Install Node.js.
2. Extract the ZIP.
3. Double click `start.bat`.

Then open:

```txt
http://localhost:3000
```

For phone/LAN testing, use the LAN IP printed in the black server window, for example:

```txt
http://192.168.1.50:3000
```

## GitHub/Railway upload

1. Delete the old files from your GitHub repo.
2. Upload all files from this folder into the repo root.
3. Commit.
4. Railway should redeploy automatically.
5. Open your domain.

## Features

- Drop-in root structure
- Username login without password
- Server-saved profiles
- Cash, XP, rank, energy, inventory and blackjack saved on server
- Shared casino bank
- Blackjack
- Roulette
- Shop
- Robberies
- Leaderboard
- Activity log with player names

## Note about Railway saves

This still uses a JSON file database. It is okay for testing, but Railway may reset file storage on redeploy/restart. Later we should switch to Postgres for permanent online saves.
