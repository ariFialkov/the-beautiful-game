# The Beautiful Game

A 3D football game with real stakes, playable on desktop and mobile as an installable PWA. Four modes — **Kick Off**, **Ultimate Team**, **Free Kick** and **Futsal** — wrapped around a strictly deterministic, RTP-controlled outcome engine.

The front end plays like a skill game: fluid player movement, dribbling, passing, shooting, tackling, keepers, 40 clubs in 15 leagues with full rosters, kits, crests and stadiums. The back end decides every round like a classic betting game *before kick-off*; the match is then paced toward that result by an in-game "director" that steers the bots.

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

Paytables live in `shared/paytable.ts`. Each mode has a fixed *shape* of paying outcomes (for matches: Draw 1.00×, Win 2.20×, and in futsal a sudden-death win 1.60×; for free kicks: Win 1.92×). There's deliberately no "win by N goals" outcome: a margin the player has to score their own way to can't be delivered honestly (see **Results that need a goal** below). The solver scales the paying probabilities so the expected return equals the configured RTP; everything else is the losing outcome. `GET /api/config` exposes the live paytables and probabilities to the client, which shows them next to the stake selector.

## How determinism works

1. **Outcome first.** `POST /api/round/start` takes the stake, draws a uniform number from `HMAC_SHA256(serverSeed, clientSeed:nonce)`, maps it through the mode's paytable to a tier (loss / draw / win / big win, or win / loss for free kicks) and seeds a PRNG with the rest of the digest to generate a *script*. The stake is taken immediately and the payout is fixed. The server-seed hash is published before the round and the seed is revealed on settlement, so every round is provably fair.
2. **Match script.** For Kick Off, Futsal and Ultimate Team the script is a final score plus a timeline of goals (fraction of regulation time, side, style). Goal orders are chosen for drama: lead changes, the eventual winner trailing, late equalisers.
   - **Futsal sudden death:** futsal has no draws. A futsal script can end level after regulation, followed by a golden goal at a set moment of the sudden-death overtime and for a set side. Every sudden-death win (its own tier, paying less than a win in normal time) and some defeats are decided this way.
   - **Overtime format:** it starts 3v3; with no goal after 15 s, it's 2v2; after another 15 s, 1v1 (each side keeps its keeper). The players who come off walk to the touchline, and the first goal ends it.
3. **The director** (`src/game/director.ts`) enforces the *result* (win, draw or loss), not an exact scoreline. How the match gets there is a **scenario** picked at random for that result, so the run of play gives little away:
   - **Defeats:** a late comeback (the player is given the chance to score first, and is helped to if they don't; the bots come back from about the hour), end-to-end then the bots pull away in the second half, an early blow, level for a long time then a sucker punch, the player leading at the break and the bots turning it round, goals traded early, or the server's own drama-ordered schedule. Many of these have the player scoring first.
   - **Draws:** a late equaliser, trading blows, the player fighting back from a goal down, a tight game, or the schedule.
   - **Wins:** always with the player scoring first (the bots can't score before them, and can never pull level once they're ahead): an early lead seen out, two up and a nervy finish, or the schedule.
   - **Beats:** a scenario is a sequence of steps: a goal engineered for one side around a time (or only encouraged, for a "soft" one), free play where both sides may score as play allows, a wait for the player to score first, a hold, and finally a settle that paces the score to the scenario's margin with the goals spread out.
   - **The player's goals always count:** no phase of a scenario holds the player back, and the keeper they face is never set to "wall" while they may score. A chance taken is a goal; the bots answer it with more of their own (starting straight away once they're two or more short). The only limit is the bots' ability to catch up in the time left, stoppage time included, so a player far ahead of the script late on can be denied.
   - **Safety layer:** for the bots' goals, whatever the scenario, a goal only stands if the result is still reachable in the time left (the bots' goals are counted at a natural pace, the player's as far less certain). When time runs short, the goals the result needs are pushed for.
   - **Extra time and penalties:** a match that's level when the added time is up, with a result that needs a winner (a win or a defeat), goes to 30 minutes of extra time, with the push for the goal carrying on. A goal is never added to the score out of nowhere. Still level in the last minutes of extra time, both defences shut up shop (no late goals) and it goes to a penalty shootout: five each, then sudden death, at one end. You take your side's kicks and choose your keeper's dive for theirs. The shootout goes the drawn way through the losing side's kicks only: one of those is saved (the keeper reads it) or struck wide just when it would knock out the side meant to win, and every other kick is taken for real, so you can still save some of theirs and score some of yours. In futsal, level with a winner needed means sudden death, and a golden goal that won't come goes to penalties the same way. A result that's still a goal short and not level plays on a little longer, as referees do. If that makes it level, it goes to extra time; the missing goals are only awarded as a last resort, which the own-goal fallback below has made practically unreachable.
   - **Results that need a goal:** a win (and a sudden-death win) needs the player's side to score, and so does a draw in which the bots took an early lead. That can't rest on the player scoring it themselves: someone who never shoots must still get the result they paid for, through play. So once such a goal is overdue (its window has passed), the defence starts to crack under the pressure. A clearance or block in the box gets sliced into the net, a defensive header loops over the keeper, a nervous back-pass (or a restart played back to the keeper) goes under the keeper's foot, and a catch or parry spills over the line. Each defensive touch in the box has a growing chance of going in, so the goal comes from play. It's credited as an own goal. The same applies the other way, through the player's AI team-mates (never the player you control), when the bots are owed a goal. In testing, players who never shoot got every win and sudden-death win with no goals awarded (24 matches across 11-a-side and futsal), and own goals are only used for goals the result needs, never to pad a margin.
   - **Auto-pilot:** if the human stalls, it takes over the controlled player.
4. **Free Kick** is turn-based with the player kicking first. The server pre-computes a reactive decision tree per round (`FreeKickRoundPlan`): what the bot does if the player scores, what it does if the player misses, the bot's shot style and miss style, whether the opposing keeper is guaranteed to stop the player this round, and whether the player's shot is quietly steered in. Losing scripts let the bot miss early kicks for suspense but end on a round where the keeper is a wall; winning scripts end on a round where the player's shot goes in and the bot misses.

The director never teleports the ball or moves it in the air. Everything happens through play:
- **Making a goal:** the side being pushed plays a quick, clean passing game. It moves the ball through the lines into a team-mate with space in a shooting position (a cut-back, a ball into the box, a through ball in behind), and a player in a real shooting spot takes it on with a touch and a strike. The defenders on the other side read those passes a beat late, mistime tackles and lose runners, and the keeper is a step slow and more likely to be sold the wrong way. The shot is aimed at the corner the keeper can't reach and struck cleanly; that's decided at the strike, and the flight is pure physics. Pace is barely touched: at most a step (about 6%) either way, so nobody outruns the whole team (in testing, nobody exceeded 106% of his own top speed). Only once a goal is well overdue do own goals come into it (a clearance or a keeper's error, at the ball's own pace).
- **Stopping a goal:** a side that may not score faces its opponents' keeper at its best, and doesn't take shots from close range (it lays the ball back off instead), since a goal that can't count can't be made to miss from a yard out without looking wrong. Every new strike (a touch, or the ball's line changing sharply off a post or a body) is checked once, the moment it happens. If it's heading in and the keeper couldn't comfortably save it, the strike itself goes slightly wrong: wide, over, or now and then onto the post. A bot about to walk the ball over the line shoots instead.
- **Last resort:** a ball that still crosses the line is knocked back off it. This is rare: about one every few matches in testing.

Settling (`POST /api/round/settle`) only pays out the pre-computed amount; leaving a match early settles at the scripted result. Pending rounds are auto-settled when the next round starts.

## Physics and conditions

- **Ball:** a full 3D model with aerodynamic drag, including the drag crisis that makes a hard-struck ball fly further. Spin curls the ball in the air (Magnus effect), topspin dips, and backspin floats. On landing, friction couples spin and speed, so a backspun ball checks and a topspun one runs on. The posts, crossbar and net are solid.
- **Conditions:** Dry, Firm, Rain, Snow and the futsal Indoor court each change bounce, skid, rolling distance and player grip. Pick them in match setup, or leave it on Random. Rain and snow are drawn on screen, and snow matches use an orange ball.
- **Dribbling:** the ball is never glued to a player's foot. Each touch pushes it ahead, further when sprinting and less precisely for weaker dribblers, and the player has to run onto it again. Passes and shots are taken when the ball is in reach.
- **Tackling:** tackles are aimed at the ball's position. Win the ball cleanly and it's yours; catch the man's legs first and it's a foul, which gives a free kick, or a penalty in the box, and sometimes a card (see **Cards** below). Committing to a tackle has a recovery time, so mashing the button doesn't work.
- **Athletes:** every player has a full skeleton: pelvis, a three-bone spine, neck, head, collarbones, arms, hands, thighs, shins and feet. A procedural motion system drives it inside the simulation:
  - **Running:** feet plant and stay put on the ground (no skating), with real contact times, stride length and cadence, a flight phase at a sprint and heel recovery.
  - **Balance:** the body leans with acceleration and banks into turns, hips and shoulders counter-rotate, and the arms swing opposite the legs.
  - **Style:** each player gets their own stride, arm carriage, posture and swagger. Dribblers glance up to scan, and some players stand with hands on hips.
  - **Actions:** kicks, touches, traps, tackles, slides, headers, dives and catches use inverse kinematics, so the boot, head or gloves really reach the ball.
- **Agility and dribbling:** players are quick off the mark, brake hard and turn sharply.
  - **Cutting:** when you change direction sharply on the ball, he plants and cuts (a brief burst of extra grip and turn) and takes the ball the new way with a short, controlled touch at once. At pace, a hard cut is bent slightly with the run. A 90° cut takes about a quarter of a second.
  - **Staying on the ball:** the dribbler moves with the ball (its velocity plus a firm pull onto his spot behind it) instead of chasing it, so he never runs past it. Touches are tight: the ball stays within about half a metre jogging and under a metre sprinting. Let go of the stick and he eases up and stops with it at his feet.
  - **Passing:** ground passes are crisp (7.5–15 m/s at the receiver; driven 15–20 m/s) with a short wind-up.
- **Limb colliders:** each bone carries a capsule collider built from the same pose that's drawn, which drives every contact:
  - **Planned contacts:** dribble touches, first touches with the foot, thigh or chest, strikes, headers, keeper saves and tackles all happen when the right limb meets the ball.
  - **Fouls:** a tackling boot that meets an opponent's leg before the ball is a foul.
  - **Everything else:** the ball rebounds off whichever limb it hits.
- **Pass assistance:** the ball always flies with the real physics, but the game works out what you meant and helps it get there.
  - **Who:** the receiver is locked in when you release: the teammate the stick points at (at him or where he's running), up to about 55° off (45° for lofted balls). For players at similar angles, nearer, unmarked players with a clear lane win, and the power bar says how far you mean (it counts most for lofted passes).
  - **Weight:** a pass to a teammate always reaches him, and the power bar sets how firmly: a tap rolls in softly (about 6 m/s at his feet), a full bar zips it in (about 10 m/s). A pass into space takes its pace from the bar alone.
  - **Through balls:** fully weighted for you. The game searches 5–14 m into the space ahead of the runner for the spot he'll win the race to, and the ball reaches it just before him, still rolling at 5 m/s or more (never a crawler), so he runs onto it in his stride. Hold through ball for power and release to play it: with two runners the same way, the power picks between them, a short hold for the nearer man and a long hold for the one further on (the same rule as crosses).
  - **Crosses and lofted passes:** they land on the team-mate in the general direction you aim (the stick nudges the exact spot by a metre or two). With two team-mates that way, the power picks between them: a harder cross finds the further man. The hold also sets the ball's shape: a tap floats it in high, a long hold drives it in flat and hard. The pace for that shape is found by simulating the flight (drag and spin included), and the receiver is led using the real flight time.
  - **Finishing crosses is up to you:** the player you control only heads or volleys a cross at goal if you press shoot (held for power) as it comes; pass heads it on to a team-mate; with nothing pressed he cushions it down or traps it. This goes for every ball in the air from your own side (crosses, passes, a weak or finesse shot that's lost its pace) and for any high ball in the attacking third: control switches to whichever team-mate is meeting it, and nobody heads or volleys it at goal for you. A press you made for the intended receiver carries over to him. Headers jump as high as the ball needs, timed to meet it.
  - **Driven pass:** RB/R1 + pass (R + Space; Finesse + Pass on touch) fizzes it along the floor at 13-18 m/s, quicker to cut through but a touch less accurate. Over longer distances (beyond about 26 m) it's struck low and hard, landing about 60% of the way and skidding on with topspin: 40 m in about 1.3 s, never above about a metre. Ground passes are firmer by default (6-13.5 m/s at the receiver).
  - **Bounce pass:** double-tap pass for a pass clipped low with topspin that hops over legs and skips on to its man; double-tap through ball for the same into a runner's path. (The second tap converts the pass before it's struck, so a single pass isn't delayed.)
  - **Lofted through ball:** LB/L1 + through ball (Q + C; Loft + Through on touch) floats it over the defence into the runner's path.
  - **In flight:** nothing. The ball flies with pure physics: the pass is solved up front for the receiver's run (from his current velocity), and if he changes direction he comes back to the ball rather than the ball bending to him. A badly hit pass can still go astray, and teammates let a pass meant for someone else run through.
  - **First time:** press pass, through ball, cross or shoot while a pass is still on its way and it's queued: the receiver plays it first time the moment the ball arrives (quick one-twos, one-touch passing moves and one-timers), with the target picked from where everyone is at that moment.
  - **Receiving:** the receiver is helped onto the ball while the stick is neutral, still held the way you passed, or pointing roughly where it's going. Push the stick a new way to take over.
    - **Where:** he takes it where he keeps his stride rather than doubling back, and times his run to arrive with the ball instead of dashing there and turning round to wait. He attacks crosses, and runs onto through balls. If a pass is underhit and won't reach where he's running, he sees it and comes back to meet it at pace, even with the stick held forward, rather than waiting for it to creep in. The same goes for a through ball that's lost its legs: as soon as, at the pace he's going, it would never catch him, he stops running on and checks back for it. He never follows a run off the pitch. While your pass is on its way, control doesn't auto-switch back to the passer, and AI teammates leave it for him.
    - **First touch:** it follows the stick if you're holding it. Otherwise it goes on along his run, or into the most open space upfield. A runner's touch keeps pace with him, and a player coming short cushions it.
    - **Hard balls:** a fast or bouncing ball, or a sprinting receiver, can mean a slightly heavy touch (the ball a metre or two ahead), never a rebound toward the defender. A pass meeting its receiver's legs before he's shaped to take it still counts as his first touch.
  - **Defenders:** they need a moment to react to a pass and find a fast ball harder to cut out.
- **Goalkeepers:** the keeper sets, shuffles across with the shot and only dives when the ball is struck and its path is known, after a human reaction time (about 0.15–0.3 s, quicker for better keepers).
  - **Dives:** a dive is a real athletic movement: a load with a counter-swing of the arms, a push off the far leg, the body launched along the goal line at the height of the ball with both arms whipping up to full stretch at it (the top arm over the head, elbows soft and pointing away from the shot), then a landing with the arms gathering in to the chest and getting up. A ball straight at the keeper is taken with a step or a stoop instead.
  - **Saves are physical:** every save happens because a glove, arm or body collider actually met the ball; there are no invisible saves, and a ball that misses the keeper's limbs goes past. Shots that hit the body are blocked and rebound; the gloves catch or parry depending on pace and handling.
  - **Beating the keeper:** the keeper can only reach as far as reaction time, dive speed and reach allow, so central and mid-height shots are usually saved and well-struck shots into the corners, especially the top corners, go in. The director's "beatable" and "wall" keepers only change reaction and dive speed; an unscheduled shot the keeper can reach is left to the keeper, and only shots out of reach are bent onto the woodwork or wide.
- **Team shape:** each side plays as a block. The back line steps up and drops with the ball, the lines stay compact out of possession and stretch wide with it, and every player keeps his lane.
  - **Loose ball:** only the player who will reach it first (or the intended receiver) goes for it.
  - **Defending:** one player presses the carrier, one covers goal-side, and the rest mark only opponents who come into their zone.
  - **Attacking:** the two nearest teammates offer diagonal angles, and teammates' positions push apart so nobody stacks up on the same patch.
- **Set pieces:** opponents must clear the ball by the full distance before a restart can be taken: 9.15 m for free kicks and corners (5 m in futsal), out of the box and 12 m away for goal kicks, and 3 m for throws. They jog out, the restart waits until they have, and anyone still in the way after about three seconds is moved. Teammates give the taker room, and the taker or keeper picks a free teammate with a clear lane.
- **Throw-ins:** the taker holds the ball in both hands behind his head from the moment he picks it up; it stays in his hands through a full wind-up (leaning back, arms cocked) and the two-armed heave, and only leaves them at the release.
- **Penalties:** taken FIFA style. The camera goes behind the taker and an aim marker sits on the goal: the stick moves it, and it springs back to the middle when you let go (elastic). Hold shoot for power and release to start the run-up, then press shoot again just as he's about to strike the ball; the timing bar shows the green window. Green is struck true, early or late adds error, and too much power lifts it. Defending one, you control the keeper: hold the stick where you want him to dive (up/down for high or low), or leave it centred to stay up the middle; he goes as the ball is struck.
- **Offside:** in 11-a-side, a team-mate in the opponents' half, ahead of the ball and beyond the second-last defender when a pass is played, is offside if he's the next to touch it. The flag goes up and the defending side gets a free kick where he was. There's no offside from a throw-in, goal kick or corner, or in futsal. AI runners hold their runs on the line until the ball is played, and bots don't pass to a team-mate who's offside.
- **Name tags:** the player you control has his name over his head ("F. Lastname", in a slim, unoutlined face), and so does any opponent on the ball (nobody's when the opponents don't have it). A booked player's name is yellow, with a small yellow card beside it. When the two meet, the tags stack instead of overlapping. Under your player's name is his stamina bar (green, then yellow below 60%, red below 30%).
- **Stamina:** every player has a stamina stat (from about 50 to 99; the midfield and full-back engine room highest, keepers lowest). In a match his energy runs down with the work he does (sprints most, then running, tackles, slides and leaps) and faster for a low stat, and comes back slowly while he walks or stands, with a breather at half time. Below 60% he loses some top speed (up to 14%) and acceleration. It resets every match. A typical player ends a game at around 35-85%; the player you control, sprinting more, tires faster.
- **Minimap:** a FIFA-style radar at the bottom of the screen: the pitch from above, every player as a dot in his team's colour, the ball, and a ring on your player. It's oriented like the camera: the pitch runs across it for the side-on cameras and up it for End-to-End, with the same left/right and up/down as the view.
- **Cards:** a reckless foul (a slide, especially from behind) gets a yellow card; a second yellow is a red. A slide that brings down an attacker through on goal with only the keeper to beat (the last man) is a straight red, and a very reckless one sometimes is too. The card is shown on screen and pops up in 3D over the offender. A booked player's name tag turns yellow with a small card beside it, and a player sent off walks to the touchline: his side plays on a man down, with a red card marked by the team's name on the scoreboard.
- **Stoppage time:** at the end of each half the fourth official's board goes up: one to three minutes at half time (one more if an attack is building), two to five at full time (one more if the result is still open; one to three in futsal). It's shown next to the clock and announced, and the half lasts that long (the first half can run on a moment to finish a move).
- **Kick-offs:** both sides line up in their own halves, the defending side outside the centre circle, and nobody moves until the ball is played. Taking it yourself, press pass as soon as the whistle goes; bots play it a moment after.
- **Goals:** the scorer wheels away toward the corner flag and finishes with a knee slide (on the knees, leaning back with the arms flung wide), a double fist pump and roar, a jumping punch at the sky, or an airplane run; team-mates chase after them and mob them, and the other side stands with hands on heads or hips, or bent over. The camera comes round in front of the scorer.
- **Instant replay:** after the celebration, the goal is replayed from a few seconds before: side-on following the build-up, then behind the goal in slow motion for the finish. Any button (or a tap) skips it. It's played from a recording of everything as it was drawn (positions, every pose, the ball), so it's exactly what happened.
- **Goalkeeper:** aim a pass back at your keeper and he's a ready outlet (the 12th man). With the ball (a catch, a back pass, a goal kick) you control him.
  - **In his hands:** he can walk with it (inside the box). Pass rolls it out along the floor, cross throws it overarm, shoot drop-kicks it upfield (held for distance), and through ball drops it at his feet to play it like an outfield player.
  - **Goal kicks:** you take them, aimed with the stick. Pass plays it short, cross chips it out, shoot boots it long.
  - **After:** once he's released it, control goes back to an outfield player.
- **Skill moves:** the right stick (the arrow keys on a keyboard; swipe on the right of the screen on touch), read relative to the way the player is facing, with the ball at his feet.
  - **Layer 1 (a flick or a hold):** flick left/right for a body feint (drop the shoulder one way, take it the other); hold left/right to roll the ball across with the sole; flick back to drag back and turn away; flick forward to knock it on into space.
  - **Layer 2 (two directions):** forward then a side for a stepover (the foot circles over the front of the ball, then he goes the other way); forward then back for a heel-to-heel; back then a side for a roulette (a full turn over the ball, dragged across with one sole then the other).
  - **Layer 3 (three directions):** a side, forward, then the other side for an elastico (out with the outside of the foot, snapped back in with the inside); back, round, then forward for a rainbow flick over his own head.
  - **How they move:** each move is keyframed in the player's frame: the body's path and turn, both feet, the lean and crouch, and the ball's path until the touch that releases it. The body and ball follow those paths with real velocities, so tackles and everything else see them move, and the animation blends in and out of the run so moves flow into each other and back into the dribble. Moves chain: hold the stick to keep rolling it.
  - **Bots:** skilful dribblers closed down now and then try a feint, stepover, roulette or drag back on the defender.
- **Keyboard movement** is on WASD (the arrows are the skill stick).
- **Finishing (assisted shooting):** the stick says which side of the keeper; the shot is drawn toward that corner (strongly in front of goal, less from range, less on Semi). In front of goal (inside about 20 m) a shot roughly toward goal is kept on target. With the stick centred it goes for the corner with the most room past the keeper from where it's struck.
- **Chip shot:** LB/L1 + shoot (Q + Z; Loft + Shoot on touch) scoops it up over the keeper with backspin to drop under the bar; more power carries it further.
- **Free kicks:** taken FIFA style, not automatically. The camera cuts to just behind the ball, over the taker's shoulder, and stays on the strike for a moment before blending back to the match camera.
  - **The wall:** sized by the danger. Close in and central (inside about 21 m) there's a full wall of five, then four, three and two further out, fewer at an angle, and a short wall of two in crossing positions. A free kick that can only be passed has no wall. The wall forms at the full distance (9.15 m; 5 m in futsal) with its end man covering the near post, holds its line, and jumps together when the ball is struck. The keeper sets on the line, shaded to the side the wall doesn't cover, and the attacking side's forwards gather in the box for the rebound.
  - **Taking it:** in shooting range, the stick moves an aim marker on the goal; LB / RB (Q / E on keyboard, the Curl buttons on touch) set how much it bends, shown on the curl meter; hold shoot for power and release to strike. The ball is struck at the aim with that pace and curl through the real ball physics, so you bend it round the wall or dip it over. Overhit it and it rises over the bar, and errors grow with power and curl. Pass, through ball and cross play it short instead. Further out, the stick turns the direction you're facing to play it. There's no rush: auto-pilot doesn't step in for 20 seconds.
  - **Bots:** a bot taker stands over the ball for a couple of seconds, then picks a strike that the physics says clears the wall (over it, or bent round it) into a corner, or plays it short if there isn't one. When you're defending, you control a player outside the wall.
- **Camera:** pick it in Settings or the pause menu. Every camera follows a critically damped focus point driven by the ball and blends without shake.
  - **Tele** (the default for 11-a-side): a tight broadcast view that leans toward the attacking direction of the team in possession. It dollies in and zooms when play is on the far side, widens slightly for the near side, and eases out for long, fast balls.
  - **High Broadcast:** higher and further back, showing more of the pitch.
  - **Ball Cam:** low and close on the near side.
  - **End-to-End** (the default for futsal): behind your team, looking up the pitch the way you attack.
- **Controller settings** (Settings or the pause menu):
  - **Passing:** Assisted (the default), or Semi: the receiver must be closer to where you aim, the power bar sets more of the pace, and strikes are a little less accurate.
  - **Shooting:** Assisted, or Semi: less pull toward the frame, a little more error.
  - **Player switching:** Auto, Air balls only, or Manual.
- **Landing marker:** when the ball goes up, a thin crosshair on the pitch marks where it will first come down, from a full simulation of its flight (spin and drag included). It glides with the prediction and grows as the ball drops.
- **Clubs and names:** 40 clubs across 15 leagues. Squads are generated together from large pools of everyday names for 36 nationalities, so names rarely repeat. Shared surnames are brothers in the same league, sometimes in the same squad, and brothers in one squad have initials on their shirts.

## Controls

| Action | Keyboard | PS5 / Xbox | Touch |
| --- | --- | --- | --- |
| Move | WASD / Arrows | Left stick / D-pad | Left joystick |
| Sprint | Shift | R2 / RT | Sprint |
| Pass · Contain (defending) | Space | ✕ / A | Pass |
| Power shot (hold for power) · Standing tackle at the ball | Z | ○ / B | Shoot |
| Low driven shot: tap, then hold | Z, Z | ○, ○ / B, B | Shoot, Shoot |
| Through ball | C | △ / Y | Through |
| Cross / lofted pass · Slide tackle (defending) | X (E also slides) | □ / X | Cross · Slide |
| Finesse shot: hold with shoot (curls in, against your run) | R | R1 / RB | Finesse (tap to arm) |
| Shield (hold) | F | L2 / LT | — |
| Switch player | Q | L1 / LB | Switch |
| Free-kick aim / curl | Arrows · Q/E | Left stick · L1/R1 | Drag · curl buttons |
| Pause | Esc | Options / Menu | ⏸ |
| Menus | Arrows · Enter · Esc | D-pad · ✕/A · ○/B | Tap |

Shots and passes are charge-and-release (hold for power). The longer you hold a cross, the lower and harder it's driven.

Shooting works like EA FC:
- **Power shot** (the default): a clean, driven strike, harder and a little higher the longer you hold.
- **Finesse shot** (hold finesse with shoot): curls in toward the far corner, bending back against your run if you're cutting across.
- **Low driven shot** (tap shoot, then press and hold again): struck flat with topspin, skimming the turf.

Touch button labels switch between attacking and defending actions automatically. On touch, Finesse is a tap-to-arm button that applies to your next shot.

## Project layout

```
shared/        data + logic shared by server and client (types, RNG, paytable, scripts, 40 teams, name pools + roster generator)
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
