# Chainline

Eighteen holes at Pine Bend. You pick a disc, aim, and throw. Putter, midrange, or driver, on every lie, until the round is on the card.

It is a fan-made phone game. The molds are real Innova and MVP discs, with the flight numbers from their sites. It is not their game, and it is not affiliated with [Innova](https://www.innovadiscs.com/) or [MVP Disc Sports](https://mvpdiscsports.com/). Nothing is loaded from those sites. The pictures and the sounds are drawn for this page.

Built the same way as [Feldstein](https://github.com/nibrocsolutions/castle): one Python container, SQLite on a Docker volume, and a page served by that same container. The flight and the card run on the server. The phone is the map, the aim stick, and the throw button.

Chainline listens on **port 8098**.

## Quick start

```bash
git clone https://github.com/nibrocsolutions/dolfgame.git
cd dolfgame
docker compose up -d --build
```

On the phone, join the same Wi-Fi as the machine and open `http://<host-ip>:8098`. The phone does not get its own build. After you pull, rebuild this same container and reload the tab:

```bash
git pull && docker compose up -d --build
```

Safari on an iPhone plays the throws from that page. The first tap clicks. The ring/silent switch has to be off, or the page stays quiet. While the page is open, the side buttons set the game volume.

Add it to the home screen (Safari: Share → Add to Home Screen, Chrome: menu → Add to Home screen) and it opens like an app.

### Useful commands

```bash
docker compose logs -f
git pull && docker compose up -d --build
docker compose down
```

`docker compose down` keeps the `chainline-data` volume. Add `-v` only when you mean to erase the players and the cards.

## What you can do

- Pick a name. The phone remembers it. Each name has its own card: rounds, best score, aces.
- Play Pine Bend, a fixed 18-hole course. Par 61. The holes are not copies of one fairway. There is a tunnel, a creek carry, an island, a dogleg, an uphill, a downhill with a road, and a par 5 to close.
- Choose a disc from the menu before each throw. The bag mixes Innova and MVP putters, midranges, and drivers.
- Throw right-hand backhand. Hyzer finishes left. Anhyzer finishes right. Flat lets the disc fly its own numbers. Wind and elevation are part of the hole.
- Water and out of bounds cost the throw plus one penalty, and you throw again from the same lie. At par + 4 the hole is picked up.
- Finish the card and the round is saved.

## Controls

- The basket stays in front of you on every throw, including the drive. Drag the fairway if you need to look around. A marker on the edge points the way when the basket is off the screen.
- The stick aims the way you are looking. Up the stick throws at the basket, and a small lean still stays on it. Aim farther left or right and the line follows, bending the way that disc flies. It starts on the disc. The line eases, so a quick flick does not yank it. How far you push fills the Power bar above Throw, and that is how hard you throw. Inside the circle, a full push is a putt, not a drive.
- A lie inside 3 ft is a gimmie. The hole is finished.
- Pines stand in the fairway and along it. They are tall trunks with a few limbs at the top. Only the trunk stops a disc, from the ground all the way up. Bushes sit on the sides and a few sit in the fairway. The ground rolls, with hills and low contours.
- The disc menu picks the mold. Hyzer, Flat, and Anhyzer set the release. Keyboard 1, 2, and 3 jump to a putter, a midrange, and a driver.
- Keyboard: arrow keys aim, J or Space throws, 1 2 3 pick the type, Q W E pick hyzer, flat, anhyzer.

## Local development

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
mkdir -p data
DATA_DIR=./data uvicorn app.main:app --reload --host 0.0.0.0 --port 8098
```

Tests:

```bash
pytest
```

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| GET, POST | `/api/players` | Find a player by name, or add one |
| PATCH, DELETE | `/api/players/{id}` | Rename or remove a player |
| GET | `/api/home?player_id=` | Record, bag, and the round in progress |
| POST | `/api/rounds` | Resume, or start a round (`fresh`) |
| GET | `/api/rounds/{id}?player_id=` | The current hole |
| POST | `/api/rounds/{id}/resolve?player_id=` | Save a finished card |
| GET | `/admin` | Player table, export, and import |
| GET | `/api/admin/summary` | Player, round, and ace counts |
| GET | `/api/admin/players` | Each player, with the round still going |
| GET | `/api/admin/export` | Download every player and every round |
| POST | `/api/admin/import` | Replace every player and every round |
| WebSocket | `/api/rounds/{id}/play?player_id=` | Aim and throw in, hole state out |

The socket expects JSON: `aim` is `[x, y]` from -1 to 1, the way the castle stick reports it (y down the screen), `power` is 0 to 1, `pressed` may include `throw`, `disc` is a mold id, and `release` is `hyzer`, `flat`, or `anhyzer`. `{"cmd":"next"}` walks to the next tee after the basket. Send about ten to twenty times a second. The server throws when `throw` is in `pressed`. `shoot` and `fire` do nothing.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_DIR` | `./data` locally, `/data` in Docker | SQLite directory |
| `PORT` | `8098` | HTTP port |
| `DATABASE_URL` | `sqlite:///{DATA_DIR}/chainline.db` | Override the database |
| `TZ` | `America/New_York` in Docker | Clock inside the container |

## Notes

- Anyone who can open the address can play, and anyone who can open `/admin` can read, export, or replace the players and the rounds. Keep it on your home network. Do not forward port 8098 to the internet.
- The phone has to reach the machine. On the same Wi-Fi, use that machine's address.
- Progress lives in SQLite. The phone only remembers the player id and whether sound is on.
- The page does not load fonts, pictures, or sound files from the internet. The throw, the chains, the trees, the water, and the birds are synthesized on the phone. Safari will not play them until a tap starts the speaker, and the iPhone mute switch silences them even then.
- The image is the multi-arch `python:3.12-slim` image, so it runs on a 64-bit Raspberry Pi and on a normal PC.

## Project layout

```
├── Dockerfile
├── docker-compose.yml
├── app/
│   ├── main.py
│   ├── flight.py
│   ├── course.py
│   ├── game.py
│   ├── api/routes.py
│   └── static/
└── tests/
```
