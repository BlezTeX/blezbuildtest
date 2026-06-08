# Banditimo v0.0.6

GitHub/Railway-ready Node.js version.

## Folder structure

Upload these files/folders to the root of your GitHub repo:

```txt
public/
data/
server.js
package.json
README.txt
start.bat
.gitignore
```

## Local test

Install Node.js, then run:

```bash
npm install
npm start
```

Open:

```txt
http://localhost:3000
```

Or on Windows, double click:

```txt
start.bat
```

## Railway deploy

This version is ready for Railway.

Railway should detect:

```txt
package.json
```

and use:

```bash
npm start
```

The server automatically uses:

```js
process.env.PORT
```

so Railway can assign the port.

## Replacing your current GitHub build

To replace your old Banana Empire test:

1. Delete the old repo contents or overwrite them.
2. Upload/extract this v0.0.6 folder contents into the repo root.
3. Commit changes.
4. Railway should redeploy.
5. Your domain should now show Banditimo.

## Important database note

This version still saves to:

```txt
data/db.json
```

That works locally and for testing. On Railway, file storage can reset after redeploys/restarts. For a proper public version, the next step should be moving player saves to a real persistent database like Railway Postgres.

## Features

- Username login without password
- Username cannot be empty or `player`
- Server-saved player profiles
- Cash, XP, rank, energy, inventory and blackjack state saved server-side
- Shared casino bank
- Blackjack
- Roulette
- Robberies
- Shop
- 10-slot inventory
- Leaderboard sorted by XP, power or cash
- Activity log with player names
