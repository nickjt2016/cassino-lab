# Cassino Lab

A single-player browser card game based on classic **Cassino**, designed as the foundation for a library of configurable fishing-card games.

## Play

Once GitHub Pages is enabled, open **https://nickjt2016.github.io/cassino-lab/** on Android, desktop, or another modern browser. This is a hosted browser app: updates to `index.html` will be published at the same URL.

Current release: **v0.3.2**. Reference-inspired green-and-gold home screen and tabletop, a New Game setup dialog, responsive card faces, original visual effects and sounds, settings grouped like a fishing-game variations menu, and playable Draw / cancelling Sweep options. Multiplayer and advanced Royal/Pirate options are labeled as future features.

## One-time GitHub Pages setup

1. Make this repository **Public** if you use GitHub Free. Navigate to **Settings → General → Danger Zone → Change repository visibility → Public**. Do not make private or sensitive content public; this repository should contain game code only.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, select **Deploy from a branch**.
4. Select branch **main** and folder **/(root)**, then **Save**.
5. When GitHub finishes publishing, visit https://nickjt2016.github.io/cassino-lab/.

Future edits to the site files on `main` are automatically published to that same URL. No repeated downloads are needed.

## Install on Android

Open the hosted site in Chrome and choose **Add to Home screen** or **Install app** from the browser menu. An internet connection is needed on first load, then the service worker can serve the cached app offline.

The service worker uses a network-first strategy and updates its cache when the page changes. On later releases, bump the `CACHE` identifier in `service-worker.js` if the asset set changes; otherwise the app still fetches the latest page when online.

## Notes

This release keeps its game engine, styling and interface together in `index.html` as a self-contained static game. The editable modular source and tests are maintained separately in the original development package. Gameplay data is stored per browser/device; it does not yet synchronize between devices.

This is a hobbyist prototype for playtesting, not yet multiplayer or an app-store release.


## Video-reference interaction update (v0.3.2)

The card table now follows the user-provided reference video more closely, while using original visuals and sounds. Its top and bottom card hands, green felt, card highlighting, and build stacks occupy a single viewport. **Build, Trail and Capture are contextual:** the action bar is hidden until a hand card is selected, then shows only moves legal for the current card and selected table groups. Clear the selection to hide the bar. Hint and Undo stay in the top toolbar.

Card rank and suit indices scale with their cards to prevent overlap on narrow Android screens. The main menu retains Resume and New Game, difficulty and variation choices. Some optional Royal and Pirate rules remain intentionally disabled until implemented.


## v0.4 – Expanded Game Variations

The Royal Aces and Royal 2-and-10 options can now use alternative numerical values in legal captures and builds. Pirate Captures, Pirate Builds, Pirate Trails, and the experimental Build To Anything option affect move legality. Draw and Sweep continue to work. Changing any variation retains its scroll position. The mobile interface uses larger centered table cards and brief context-sensitive actions like **Build J**, **Multiple build 10**, **Capture cards** and **Trail**. Computer moves pause longer and animate toward the table or capture area. All 25 automated checks pass.


## Version 0.4.1 — UI and Royal labels

- New Game → Custom opens the editable variations menu; Back returns to New Game; Start Game uses the selected custom rules and selected difficulty. Custom choices are saved separately from the current match.
- Main-menu title now uses a clean SVG card fan and responsive type instead of overlapping HTML cards.
- Hands, table cards and opponent card backs are larger; the backs use a woven diamond motif.
- Cards fly at full opacity when trailed or built; only captured cards fade on the way to the captured pile.
- You may select loose table cards or builds before selecting a hand card; highlights persist. Selected build stacks now glow yellow, including their constituent cards.
- Royal move labels pair rank and target value: Build Q (14), Build A (14), Multiple Build A (14) when the indicated move is legal. Royal J/Q/K normally count as 11/12/13, and Royal Aces as 1 or 14; displaying a target beside a rank does not change that card's inherent value.


## v0.4.3 — smoother gameplay animation

Card movements now use eased physical flights, staggered redeals, and FLIP transitions for surviving table cards. Trail and build motions remain opaque; cards fade only when captured. Contextual move prompts and dialogs have gentler entrances, and system reduced-motion preferences are supported. Saved matches remain compatible.


## v0.4.6 — physical capture stacks, end-of-hand settlement, readable scoring

During a capture, the player's actual face-up card moves from their hand over the selected table cards. Every captured card, including cards inside a build, slides beneath it, then the whole assembled stack travels back to that player's capture area. Only the returning captured stack fades.

At the end of a hand, loose cards remaining on the table are collected by the player who made the last capture. This collection finishes before hand scoring appears. The results table now labels category point values (such as Most cards (3), Aces (1–4)), bolds the higher number in each category and highlights the hand winner. Dealing uses a louder quick sequence of original synthesized card-snap sounds synchronized with cards flying from the stock on the left.

## Readable build stacks (v0.4.7)

Builds remain physical card piles, not icons. The cards form a stepped solitaire stack, with the upper rank and suit of each constituent card exposed. The numerical build-value strip is flush with the bottom of the last card, and it appears after the cards settle. Compact spacing is used on shorter screens and for large builds.


### v0.4.8 — computer trails
The opponent's trailed card flips face-up over the hand, scales smoothly to exactly the loose-table-card dimensions, and lands without a size jump. The same sizing applies when the trail finishes the hand, with a separate safeguard for an already-cleared table. This update preserves the existing animation timing and legal moves.


### v0.4.9 — physical replacement-card dealing
Replacement cards in Draw mode no longer appear immediately in the hand: each travels face-down from the left stock, flips on arrival, and then becomes selectable. New hands and initial table cards are dealt face-down as well. Card input is held while dealing. Build columns align straight and the felt no longer displays an empty-table caption.
