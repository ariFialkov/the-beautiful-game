# The Beautiful Game

A 3D football game with real stakes, playable on desktop and mobile as an installable PWA. Four modes — **Kick Off**, **Ultimate Team**, **Free Kick** and **Futsal** — wrapped around a strictly deterministic, RTP-controlled outcome engine.

The front end plays like a skill game: fluid player movement, dribbling, passing, shooting, tackling, keepers, 24 clubs with full rosters, kits, crests and stadiums. The back end decides every round like a classic betting game *before kick-off*; the match is then paced toward that result by an in-game "director" that steers the bots.

## Play it now

**https://arifialkov.github.io/the-beautiful-game/** — a static build deployed by GitHub Actions (`.github/workflows/pages.yml`) on every push.

That build has no outcome server, so it runs the identical engine inside the browser ("DEMO" badge in the wallet): outcomes are still RTP-driven and provably fair, but the server seed, wallet and Ultimate Team club live in that browser's local storage, and the RTP can be changed from Settings without a token. Install it from the browser menu to get the full-screen PWA. For real deployments run the outcome server below.

## Quick start

```bash
npm install
npm run dev          # outcome server on :8787 + Vite client on :5173
```

Open http://localhost:5173. For a production build served by the outcome server (single origin, PWA-installable):

```bash
npm run build
npm start            # serves dist/ and /api on http://localhost:8787
```

Tests (RTP maths, script generation, rosters, and headless full-match simulations that assert the scripted score is reached without failsafes):

```bash
npm test
```

## Configuring RTP

RTP (return to player) is configurable per mode and can be changed at runtime.

| Method | How |
| --- | --- |
| Environment (startup) | `RTP=0.95 npm start` sets all modes; `RTP_FREEKICK=0.97` overrides one mode (`RTP_KICKOFF`, `RTP_FUTSAL`, `RTP_FUT`, `RTP_FREEKICK`) |
| Admin API (runtime) | `POST /api/admin/rtp {"token": "<ADMIN_TOKEN>", "mode": "all" \| "<mode>", "rtp": 0.96}` |
| In-app | Settings → *Operator · RTP* panel (needs the same token) |

`ADMIN_TOKEN` defaults to `change-me`. Set it in production.

Paytables live in `shared/paytable.ts`. Each mode has a fixed *shape* of paying outcomes (for matches: Draw 1.00×, Win 2.20×, Win by 3+ 5.00×; for free kicks: Win 1.92×). The solver scales the paying probabilities so the expected return equals the configured RTP; everything else is the losing outcome. `GET /api/config` exposes the live paytables and probabilities to the client, which shows them next to the stake selector.

## How determinism works

1. **Outcome first.** `POST /api/round/start` takes the stake, draws a uniform number from `HMAC_SHA256(serverSeed, clientSeed:nonce)`, maps it through the mode's paytable to a tier (loss / draw / win / big win, or win / loss for free kicks) and seeds a PRNG with the rest of the digest to generate a *script*. The stake is taken immediately and the payout is fixed. The server-seed hash is published before the round and the seed is revealed on settlement, so every round is provably fair.
2. **Match script.** For Kick Off, Futsal and Ultimate Team the script is a final score plus a timeline of goals (fraction of regulation time, side, style). Goal orders are chosen for drama: lead changes, the eventual winner trailing, late equalisers.
3. **The director** (`src/game/director.ts`) enforces it. Around each scripted goal a window opens for that side only: the attacking side's bots get sharper and quicker, the defending keeper becomes beatable, tackles favour the attackers, and if the goal still has not come the shot in flight is steered into the net. Between windows *no* goal is allowed: keepers are walls and anything that would cross the line hits the woodwork. The human can play as well or as badly as they like — the score at full time is always the scripted one. If the human stalls, an auto-pilot takes over the controlled player; a hard failsafe awards any remaining goals only after an extended stoppage time.
4. **Free Kick** is turn-based with the player kicking first. The server pre-computes a reactive decision tree per round (`FreeKickRoundPlan`): what the bot does if the player scores, what it does if the player misses, the bot's shot style and miss style, whether the opposing keeper is guaranteed to stop the player this round, and whether the player's shot is quietly steered in. Losing scripts let the bot miss early kicks for suspense but end on a round where the keeper is a wall; winning scripts end on a round where the player's shot goes in and the bot misses.

The director never teleports the ball or fakes a result on screen. It works through the same physics the players do:
- **Goal windows:** around each scheduled goal, the scoring side gets sharper first touches, passing and pace. Defenders on the other side start to misread balls and hold off tackles, and that keeper becomes beatable.
- **Overdue goals:** if a goal is late, the shot in flight is guided toward its target.
- **Unscheduled goals:** a shot that would go in is bent onto the post, wide or over the bar before it reaches the line, using the same path prediction the keepers use.

Settling (`POST /api/round/settle`) only pays out the pre-computed amount; leaving a match early settles at the scripted result. Pending rounds are auto-settled when the next round starts.

## Physics and conditions

- **Ball:** a full 3D model with aerodynamic drag, including the drag crisis that makes a hard-struck ball fly further. Spin curls the ball in the air (Magnus effect), topspin dips, and backspin floats. On landing, friction couples spin and speed, so a backspun ball checks and a topspun one runs on. The posts, crossbar and net are solid.
- **Conditions:** Dry, Firm, Rain, Snow and the futsal Indoor court each change bounce, skid, rolling distance and player grip. Pick them in match setup, or leave it on Random. Rain and snow are drawn on screen, and snow matches use an orange ball.
- **Dribbling:** the ball is never glued to a player's foot. Each touch pushes it ahead, further when sprinting and less precisely for weaker dribblers, and the player has to run onto it again. Passes and shots are taken when the ball is in reach.
- **Tackling:** tackles are aimed at the ball's position. Win the ball cleanly and it's yours; catch the man's legs first and it's a foul, which gives a free kick, or a penalty in the box, and sometimes a yellow card. Committing to a tackle has a recovery time, so mashing the button doesn't work.
- **Athletes:** every player has a full skeleton: pelvis, a three-bone spine, neck, head, collarbones, arms, hands, thighs, shins and feet. A procedural motion system drives it inside the simulation:
  - **Running:** feet plant and stay put on the ground (no skating), with real contact times, stride length and cadence, a flight phase at a sprint and heel recovery.
  - **Balance:** the body leans with acceleration and banks into turns, hips and shoulders counter-rotate, and the arms swing opposite the legs.
  - **Style:** each player gets their own stride, arm carriage, posture and swagger. Dribblers glance up to scan, and some players stand with hands on hips.
  - **Actions:** kicks, touches, traps, tackles, slides, headers, dives and catches use inverse kinematics, so the boot, head or gloves really reach the ball.
- **Limb colliders:** each bone carries a capsule collider built from the same pose that's drawn, which drives every contact:
  - **Planned contacts:** dribble touches, first touches with the foot, thigh or chest, strikes, headers, keeper saves and tackles all happen when the right limb meets the ball.
  - **Fouls:** a tackling boot that meets an opponent's leg before the ball is a foul.
  - **Everything else:** the ball rebounds off whichever limb it hits.
- **Pass assistance:** the ball always flies with the real physics, but the game works out what you meant and helps it get there.
  - **Who:** the receiver is locked in when you release: the teammate the stick points at (at him or where he's running), up to about 55° off (45° for lofted balls). For players at similar angles, nearer, unmarked players with a clear lane win, and the power bar says how far you mean (it counts most for lofted passes).
  - **Weight:** a pass to a teammate is weighted for him. The power bar only nudges the pace, so a misjudged bar still arrives. A pass into space takes its pace from the bar alone.
  - **Through balls:** the game searches the space ahead of the runner for the spot he'll win the race to. It weights the ball to arrive there as he does, and he runs onto it and takes it in his stride.
  - **Crosses:** crosses are driven at about head height; the longer you hold, the lower and harder. The trajectory is led using its real flight time.
  - **In flight:** the pass bends gently toward its receiver, like a touch of curl, without changing its pace. A defender standing right in front of the passer is played around.
  - **Receiving:** the receiver is helped onto the ball while the stick is neutral, still held the way you passed, or pointing roughly where it's going. Push the stick a new way to take over.
    - **Where:** he takes it where he keeps his stride rather than doubling back, and times his run to arrive with the ball instead of dashing there and turning round to wait. He attacks crosses, and runs onto through balls.
    - **First touch:** it follows the stick if you're holding it. Otherwise it goes on along his run, or into the most open space upfield. A runner's touch keeps pace with him, and a player coming short cushions it.
    - **Hard balls:** a fast or bouncing ball, or a sprinting receiver, can mean a slightly heavy touch (the ball a metre or two ahead), never a rebound toward the defender. A pass meeting its receiver's legs before he's shaped to take it still counts as his first touch.
  - **Defenders:** they need a moment to react to a pass and find a fast ball harder to cut out.
- **Team shape:** each side plays as a block. The back line steps up and drops with the ball, the lines stay compact out of possession and stretch wide with it, and every player keeps his lane.
  - **Loose ball:** only the player who will reach it first (or the intended receiver) goes for it.
  - **Defending:** one player presses the carrier, one covers goal-side, and the rest mark only opponents who come into their zone.
  - **Attacking:** the two nearest teammates offer diagonal angles, and teammates' positions push apart so nobody stacks up on the same patch.
- **Set pieces:** opponents must clear the ball by the full distance before a restart can be taken: 9.15 m for free kicks and corners (5 m in futsal), out of the box and 12 m away for goal kicks, and 3 m for throws. They jog out, the restart waits until they have, and anyone still in the way after about three seconds is moved. Teammates give the taker room, and the taker or keeper picks a free teammate with a clear lane.
- **Camera:** the broadcast camera follows a critically damped focus point driven by the ball. It leans toward the attacking direction of the team in possession and blends between shots without shake.

## Controls

| Action | Keyboard | PS5 / Xbox | Touch |
| --- | --- | --- | --- |
| Move | WASD / Arrows | Left stick / D-pad | Left joystick |
| Sprint | Shift | R2 / RT | Sprint |
| Pass · Contain (defending) | Space | ✕ / A | Pass |
| Shoot · Standing tackle at the ball | Z | ○ / B | Shoot |
| Through ball | C | △ / Y | Through |
| Cross / lofted pass · Slide tackle (defending) | X (E also slides) | □ / X | Cross · Slide |
| Finesse shot (hold) | R | R1 / RB | — |
| Shield (hold) | F | L2 / LT | — |
| Switch player | Q | L1 / LB | Switch |
| Free-kick aim / curl | Arrows · Q/E | Left stick · L1/R1 | Drag · curl buttons |
| Pause | Esc | Options / Menu | ⏸ |
| Menus | Arrows · Enter · Esc | D-pad · ✕/A · ○/B | Tap |

Shots and passes are charge-and-release (hold for power). The longer you hold a cross, the lower and harder it's driven. Touch button labels switch between attacking and defending actions automatically.

## Project layout

```
shared/        data + logic shared by server and client (types, RNG, paytable, scripts, 24 teams + roster generator)
server/        Node outcome server: provably-fair rounds, wallet, FUT club/packs, admin RTP, static PWA hosting
src/app        client state, API client, router, audio
src/input      keyboard / gamepad / touch → unified input
src/game       simulation: pitch, ball physics, agents, bot AI, keeper AI, director, match rules
src/render     Three.js: procedural humanoids + animation, kits, crests, stadium + crowd, cameras, match view
src/freekick   turn-based free-kick duel
src/fut        Ultimate Team chemistry
src/screens    home (highlight tape), kick off / futsal setup, live match, FUT hub, free kick, settings
tests/         unit tests + headless simulation tests
public/        PWA manifest, service worker, icons
```

Everything visual is procedural (no external assets): kits are canvas textures, crests are SVG, stadiums are built from team colours, and players are articulated low-poly humanoids animated in code. The home screen plays an AI-vs-AI "league highlights" match with cinematic camera cuts under a broadcast filter.

## Deploying

- **Static (GitHub Pages / any CDN):** `BASE_PATH=/<repo>/ VITE_LOCAL_ENGINE=true npm run build:client` and publish `dist/`. The workflow does this automatically; Pages is enabled by the workflow itself (`actions/configure-pages` with `enablement: true`).
- **With the outcome server:** `npm run build && npm start` serves the PWA and `/api` from one origin. To host the client elsewhere, build it with `VITE_API_BASE=https://your-server` so API calls go to the server.

## Notes

- Clubs, players and leagues are fictional.
- Wallet credits are a demo currency held in `server/data/store.json`; there is no real-money handling or authentication. Player identity is a random id stored in the browser.
- Quality auto-detects (touch devices run without real-time shadows); it can be forced in Settings.
