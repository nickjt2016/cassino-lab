# Cassino Lab

A single-player browser card game based on classic **Cassino**, designed as the foundation for a library of configurable fishing-card games.

## Play

Once GitHub Pages is enabled, open **https://nickjt2016.github.io/cassino-lab/** on Android, desktop, or another modern browser. This is a hosted browser app: updates to `index.html` will be published at the same URL.

Current release: **v0.5.24**. Reference-inspired green-and-gold home screen and tabletop, a New Game setup dialog, responsive card faces, original visual effects and sounds, settings grouped like a fishing-game variations menu, and playable Draw / cancelling Sweep options. Multiplayer and advanced Royal/Pirate options are labeled as future features.

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

This release keeps its game engine, styling and interface together in `index.html` as a self-contained static game. The canonical editable sources are in `src/`. Run `npm run build` to regenerate `index.html`, then `npm test` to validate release parity and the rules engine. `npm start` serves the repository root. Gameplay data is stored per browser/device; it does not yet synchronize between devices.

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


## Install as an app (v0.5.0)
Open the GitHub Pages URL in Chrome on Android, then choose **⋮ → Add to Home screen → Install app**. The PWA runs standalone and caches the game for offline play. Publishing updates to `main` changes the app at the existing URL; the app checks for releases at launch and when returning to the foreground. If an updated service worker takes control while you're on the main menu, Cassino Lab reloads automatically. During an active game, it waits for the player to return to the main menu or select **Update now** instead of interrupting a turn. Game data is kept in browser-local storage and doesn't synchronize across devices.


### v0.5.1 — unambiguous build raises
A raise is now labeled for its **new build target**, rather than the rank of the card used to raise it. For example, adding A=1 to an existing 2+7=9 build while retaining 10 correctly displays **Raise to 10**, not "Raise to A (10)." Creating and extending builds still show special Royal ranks and numeric values when useful (e.g. **Build Q (14)** and **Multiple Build A (14)**).


### v0.5.2 — fully automatic safe updates
Cassino Lab checks `version.json` when it opens, when connectivity returns, and when the app comes to the foreground. A newer release is installed automatically when the main menu is showing and no dialog is open. During play, the upgrade is deferred until the player returns to the main menu. A short reload guard prevents loops if a hosting cache temporarily serves an old page. The existing PWA service worker still provides offline play and is updated alongside each release. Game saves continue using browser-local storage.

### v0.5.3 — fixes for the four reported issues
- Custom Rules settings toggle updates preserve the existing dialog and scroll position, preventing flashes.
- Four loose table cards fit on one row on phones down to 320px; side builds occupy an upper-right lane.
- In Draw mode, replacement-card animations no longer incorrectly hide existing loose table cards or just-trailed cards.
- Build labels sit flush at the bottom of the top card and cover the lower portion of its large rank.


### v0.5.4 — reference-video build-pile refinement
Builds remain straight stacks of actual cards, with visible rank/suit corners and no horizontal fanning. The frontmost card now has a full-width black panel covering roughly the lower two thirds, showing the owner name above the announced target (e.g. **You · K**). The black panel appears only after the existing card-stack animation finishes. The card row, Draw-mode behavior, and main-menu updates are unchanged.


### v0.5.5 — stable New Game / Custom Rules navigation and exit confirmation
- Opening **New Game** keeps the main-menu DOM and its scroll position intact. Selecting difficulty or preset doesn't jump the home page back to the top.
- **New Game → Custom** pushes Game Variations as a second, opaque panel over the still-mounted New Game dialog and reuses the same backdrop, avoiding flashing between main-menu and dialog screens. Closing Game Variations returns to the unchanged New Game panel, and setting explanations preserve the stack.
- Leaving a game from the upper-left X or from **Game menu → Main menu** now asks **“Are you sure you want to exit this game?”** with **Keep playing** and **Exit to menu**. Canceling preserves play and current menus. Confirming returns home and saves the match for Resume Game.
- Other gameplay and automatically installed releases remain unchanged.

### v0.5.6 — reference-video gameplay blocking
Compared the green-felt gameplay with the two user-supplied recordings (1000063672.mp4 and 1000063673.mp4), including the sequence where a K-build becomes a multiple K-build. The table uses independent stock (left), loose-card (middle-left), and build (right) lanes. Unlike the previous layout, builds no longer jump above the card row or push the loose cards around. Four initial loose cards fit in one row at 320, 360, and 390px viewport widths, even when a build is present. Existing overlapping full-card build stacks, the owner/value panel, card-flight paths, contextual action prompts, and the v0.5.5 stacked-menu/exit-confirmation logic are retained. Check against the reference recordings on every layout/animation revision, and keep visual regression tests current.

### v0.5.7 — reference-video straight card movement
From the user's second reference recording (1000063673.mp4), the extension of a K-build happens over roughly half a second. Cassino Lab now starts successive cards 48ms apart instead of 72ms, flies each card in 310–365ms rather than 380–420ms, and shows the black owner/value panel after 65ms with a 140ms settling transition. Flights now follow direct paths without the previous artificial vertical hop, and cards scale in both dimensions to their final build positions. Existing trail, capture and dealing choreography remains intact.

### v0.5.8 — numerical build panel and HUD deck
The value panel on a build occupies the lower 77% of the topmost card, leaving the top 23% with the real rank/suit index visible. The label always shows the **numerical build target**, including 1/11/12/13/14 when A/J/Q/K participate numerically; it does not substitute the face-card letter. The physical draw deck is relocated into the rightmost **Cards in Deck** HUD cell alongside its count, freeing the former stock lane on the left of the table. Dealing sound and face-down card animations still originate from the actual moved `.draw-stock` element. Layout retains a side lane for builds and full-width loose cards when no build is present.

### v0.5.9 — modest card-size reduction
All gameplay cards are about 8–10% smaller: the player's hand, loose cards on the table, opponent card backs and stacked build cards. The tiny deck graphic in the HUD is reduced slightly too. Physical element dimensions are used rather than transform-based visual scaling, so card-flight start/end points, build stacking and face-up reveals still match their measured positions. Corner indices scale with the card via container-width units; no change to legal moves, scoring, custom settings, or automatic updates.

### v0.5.10 — loose table cards close gaps from left to right
Following reference recording `1000063678.mp4`, loose table cards retain a fixed left-side start position even as other cards are captured or converted into builds. When an 8 leaves the first loose slot to form a build, the remaining 7 shifts left to occupy that first slot over 355ms with an eased transition. The layout no longer recenters the row after the build disappears or appears. Existing cards retain their unique table IDs during FLIP transitions, and build cards remain in the independent right-side lane. The order of loose cards does not change.

### v0.5.11 — mirrored capture staging and clear turn labels
On capture, the face-up capturing card moves over selected loose cards or each card layer of a build; all captured cards converge beneath it. The assembled stack then moves into empty space in front of the capturer (lower field for the human, upper field for the computer), pauses briefly, and only then shrinks toward the captured-card area. This preserves the entire physical card stack until collection. The turn banner now displays only **Your turn** or **Opponent's turn**, including during deal/capture transitions. Build card corner ranks and suit symbols share a common baseline and rank-column width for consistent shoulder alignment.

### v0.5.12 — rules engine and maintenance
Fixed a deadlock in Build To Anything when the owner cannot capture their own build. Royal alternate capture values are enumerated separately. Human and computer turn completion share one path; obsolete menu and announcement state was removed. Added deterministic full-hand gameplay and release-parity tests.

### v0.5.13 — direct captures
The played card and captured cards fly directly to a stack in front of the capturing player, with the played card on top. No intermediate stop at the table center or over a build. The stack then moves into the capture total; computer captures mirror the human position.

### v0.5.14 — build labels
Build, Multiple Build and Raise to display only the numerical target of the resulting stack, including Royal Aces and the special 2/10 values. Played-card ranks and parenthesized totals are omitted. Non-numerical face-card builds are not currently legal in Classic Cassino; no game rules were changed.

### v0.5.15 — consistent card artwork
Every full-size card uses the same centered two-column shoulder index, with compact uniform spacing. Rank and suit are aligned across builds without a build-only style. Card backs use the original blue motif at proportional sizes; moving cards keep their normal paper, ink, border and shadow. Selection uses a golden outline rather than recoloring the paper. The face changes only during deliberate flips; existing capture and deal paths are unchanged.

### v0.5.16 — turn timing and opponent clearance
The controls form a vertical top-left rail, freeing the row above the opponent. Computer captures use the measured open lane above the table cards and leave a visible gap; only cramped layouts scale the entire stack to fit. A captured build's value panel fades out over 130 ms. Both turn banners fade out on a committed move and the next one appears only after movement and replacement dealing finish. The opponent's banner stays visible while it is thinking.

### v0.5.17 — unified game setup
New Game and Game Variations now use a single scrollable dialog. Select Original, Royal, Spade, Royal Spade, or Custom once. All rule switches and the winning-score control display the selected preset and are locked until Custom is selected. Difficulty stays independent. Custom edits survive switching between presets in the same session and are saved when starting a custom match; on first use, Custom inherits the previously previewed preset. Rule explanations expand inline. No gameplay rules changed.

### v0.5.18 — toolbar and hints
Restored a horizontal toolbar with Exit on the left and Hint, optional Undo, and Menu on the right. The separate info button was removed; How to play remains in the menu. The Undo preference is saved on the device; while off, Undo is unavailable in the toolbar, round results, and keyboard shortcut. Hints independently rank legal candidates and highlight the relevant cards and precise recommended action (including a specific build target). They never play automatically. The opponent's measured capture lane remains intact.

### v0.5.19 — cleaner setup
Removed the explanatory paragraph below the variation selector for all presets and Custom. Rule switch behavior and individual rule explanations are unchanged.

### v0.5.20 — editable presets and consistent filled highlights
Every variation's options and winning score are editable immediately. Editing a preset switches to Custom while retaining its other rules. Enabling a build-dependent rule also enables building if needed. Selection fills the entire card or build with pale yellow, including its value panel; redundant outlines and extra shadows are removed. Individual build cards retain their source artwork, fade only the selection tint on movement, and move to their final dimensions without recreating or raster-scaling the face.

### v0.5.21 — build panels and table timing
Menu joins Exit on the left; the computer score occupies the middle of the toolbar, with Hint and Undo on the right. The new build panel starts invisible and fades in over 140 ms after landing; the next turn waits for it. Extended builds retain the previous panel until incoming layers cover it. Multiple-build group boundaries use a dark top border fading into the regular outline. Loose survivors wait 160 ms after capture movement begins before sliding into gaps; CPU captures include the card-flip delay.

### v0.5.22 — selection colors
The build value and owner use pure white ink on a permanently black panel. Selecting a build turns the ink the same pale yellow as the selected card paper. Cards and builds use their existing physical borders in gold, without additional stacked outlines; multiple-build separators remain dark and blend into the gold edge. Selection paper and border fade together when cards move.

### v0.5.23 — cycling hints and capture clearance
Hint taps cycle through distinct legal hand/table selections, captures first, builds next, and trails last, then wrap around. Every action for a selection appears in the ordinary contextual controls; no special hint marker or outline. The lazy exact-selection search is independent of AI difficulty and its move-count limits. Human captures land beneath the lowest table cards with a measured gap, using the full card size where space allows. Existing CPU capture spacing and delayed table reflow are retained.

### v0.5.24 — clean empty table
Removed the dashed empty-table placeholder and its unused sizing rule. The felt is uninterrupted when no table cards remain.
