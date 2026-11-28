# Fishing Lab

A single-player browser card game based on classic **Cassino**, designed as the foundation for a library of configurable fishing-card games.

## Play

Once GitHub Pages is enabled, open **https://nickjt2016.github.io/cassino-lab/** on Android, desktop, or another modern browser. This is a hosted browser app: updates to `index.html` will be published at the same URL.

Current release: **v0.5.35**. Reference-inspired green-and-gold home screen and tabletop, a New Game setup dialog, responsive card faces, original visual effects and sounds, settings grouped like a fishing-game variations menu, and playable Draw / cancelling Sweep options. Multiplayer and advanced Royal/Pirate options are labeled as future features.

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
- You may select table cards or builds before selecting a hand card; highlights persist. Selected build stacks now glow yellow, including their constituent cards.
- Royal move labels pair rank and target value: Build Q (14), Build A (14), Multiple Build A (14) when the indicated move is legal. Royal J/Q/K normally count as 11/12/13, and Royal Aces as 1 or 14; displaying a target beside a rank does not change that card's inherent value.


## v0.4.3 — smoother gameplay animation

Card movements now use eased physical flights, staggered redeals, and FLIP transitions for surviving table cards. Trail and build motions remain opaque; cards fade only when captured. Contextual move prompts and dialogs have gentler entrances, and system reduced-motion preferences are supported. Saved matches remain compatible.


## v0.4.6 — physical capture stacks, end-of-hand settlement, readable scoring

During a capture, the player's actual face-up card moves from their hand over the selected table cards. Every captured card, including cards inside a build, slides beneath it, then the whole assembled stack travels back to that player's capture area. Only the returning captured stack fades.

At the end of a hand, table cards remaining on the table are collected by the player who made the last capture. This collection finishes before hand scoring appears. The results table now labels category point values (such as Most cards (3), Aces (1–4)), bolds the higher number in each category and highlights the hand winner. Dealing uses a louder quick sequence of original synthesized card-snap sounds synchronized with cards flying from the stock on the left.

## Readable build stacks (v0.4.7)

Builds remain physical card piles, not icons. The cards form a stepped solitaire stack, with the upper rank and suit of each constituent card exposed. The numerical build-value strip is flush with the bottom of the last card, and it appears after the cards settle. Compact spacing is used on shorter screens and for large builds.


### v0.4.8 — computer trails
The opponent's trailed card flips face-up over the hand, scales smoothly to exactly the table-card dimensions, and lands without a size jump. The same sizing applies when the trail finishes the hand, with a separate safeguard for an already-cleared table. This update preserves the existing animation timing and legal moves.


### v0.4.9 — physical replacement-card dealing
Replacement cards in Draw mode no longer appear immediately in the hand: each travels face-down from the left stock, flips on arrival, and then becomes selectable. New hands and initial table cards are dealt face-down as well. Card input is held while dealing. Build columns align straight and the felt no longer displays an empty-table caption.


## Install as an app (v0.5.0)
Open the GitHub Pages URL in Chrome on Android, then choose **⋮ → Add to Home screen → Install app**. The PWA runs standalone and caches the game for offline play. Publishing updates to `main` changes the app at the existing URL; the app checks for releases at launch and when returning to the foreground. If an updated service worker takes control while you're on the main menu, Fishing Lab reloads automatically. During an active game, it waits for the player to return to the main menu or select **Update now** instead of interrupting a turn. Game data is kept in browser-local storage and doesn't synchronize across devices.


### v0.5.1 — unambiguous build raises
A raise is now labeled for its **new build target**, rather than the rank of the card used to raise it. For example, adding A=1 to an existing 2+7=9 build while retaining 10 correctly displays **Raise to 10**, not "Raise to A (10)." Creating and extending builds still show special Royal ranks and numeric values when useful (e.g. **Build Q (14)** and **Multiple Build A (14)**).


### v0.5.2 — fully automatic safe updates
Fishing Lab checks `version.json` when it opens, when connectivity returns, and when the app comes to the foreground. A newer release is installed automatically when the main menu is showing and no dialog is open. During play, the upgrade is deferred until the player returns to the main menu. A short reload guard prevents loops if a hosting cache temporarily serves an old page. The existing PWA service worker still provides offline play and is updated alongside each release. Game saves continue using browser-local storage.

### v0.5.3 — fixes for the four reported issues
- Custom Rules settings toggle updates preserve the existing dialog and scroll position, preventing flashes.
- Four table cards fit on one row on phones down to 320px; side builds occupy an upper-right lane.
- In Draw mode, replacement-card animations no longer incorrectly hide existing table cards or just-trailed cards.
- Build labels sit flush at the bottom of the top card and cover the lower portion of its large rank.


### v0.5.4 — reference-video build-pile refinement
Builds remain straight stacks of actual cards, with visible rank/suit corners and no horizontal fanning. The frontmost card now has a full-width black panel covering roughly the lower two thirds, showing the owner name above the announced target (e.g. **You · K**). The black panel appears only after the existing card-stack animation finishes. The card row, Draw-mode behavior, and main-menu updates are unchanged.


### v0.5.5 — stable New Game / Custom Rules navigation and exit confirmation
- Opening **New Game** keeps the main-menu DOM and its scroll position intact. Selecting difficulty or preset doesn't jump the home page back to the top.
- **New Game → Custom** pushes Game Variations as a second, opaque panel over the still-mounted New Game dialog and reuses the same backdrop, avoiding flashing between main-menu and dialog screens. Closing Game Variations returns to the unchanged New Game panel, and setting explanations preserve the stack.
- Leaving a game from the upper-left X or from **Game menu → Main menu** now asks **“Are you sure you want to exit this game?”** with **Keep playing** and **Exit to menu**. Canceling preserves play and current menus. Confirming returns home and saves the match for Resume Game.
- Other gameplay and automatically installed releases remain unchanged.

### v0.5.6 — reference-video gameplay blocking
Compared the green-felt gameplay with the two user-supplied recordings (1000063672.mp4 and 1000063673.mp4), including the sequence where a K-build becomes a multiple K-build. The table uses independent stock (left), table-card (middle-left), and build (right) lanes. Unlike the previous layout, builds no longer jump above the card row or push the table cards around. Four initial table cards fit in one row at 320, 360, and 390px viewport widths, even when a build is present. Existing overlapping full-card build stacks, the owner/value panel, card-flight paths, contextual action prompts, and the v0.5.5 stacked-menu/exit-confirmation logic are retained. Check against the reference recordings on every layout/animation revision, and keep visual regression tests current.

### v0.5.7 — reference-video straight card movement
From the user's second reference recording (1000063673.mp4), the extension of a K-build happens over roughly half a second. Fishing Lab now starts successive cards 48ms apart instead of 72ms, flies each card in 310–365ms rather than 380–420ms, and shows the black owner/value panel after 65ms with a 140ms settling transition. Flights now follow direct paths without the previous artificial vertical hop, and cards scale in both dimensions to their final build positions. Existing trail, capture and dealing choreography remains intact.

### v0.5.8 — numerical build panel and HUD deck
The value panel on a build occupies the lower 77% of the topmost card, leaving the top 23% with the real rank/suit index visible. The label always shows the **numerical build target**, including 1/11/12/13/14 when A/J/Q/K participate numerically; it does not substitute the face-card letter. The physical draw deck is relocated into the rightmost **Cards in Deck** HUD cell alongside its count, freeing the former stock lane on the left of the table. Dealing sound and face-down card animations still originate from the actual moved `.draw-stock` element. Layout retains a side lane for builds and full-width table cards when no build is present.

### v0.5.9 — modest card-size reduction
All gameplay cards are about 8–10% smaller: the player's hand, table cards on the table, opponent card backs and stacked build cards. The tiny deck graphic in the HUD is reduced slightly too. Physical element dimensions are used rather than transform-based visual scaling, so card-flight start/end points, build stacking and face-up reveals still match their measured positions. Corner indices scale with the card via container-width units; no change to legal moves, scoring, custom settings, or automatic updates.

### v0.5.10 — table cards close gaps from left to right
Following reference recording `1000063678.mp4`, table cards retain a fixed left-side start position even as other cards are captured or converted into builds. When an 8 leaves the first table-card slot to form a build, the remaining 7 shifts left to occupy that first slot over 355ms with an eased transition. The layout no longer recenters the row after the build disappears or appears. Existing cards retain their unique table IDs during FLIP transitions, and build cards remain in the independent right-side lane. The order of table cards does not change.

### v0.5.11 — mirrored capture staging and clear turn labels
On capture, the face-up capturing card moves over selected table cards or each card layer of a build; all captured cards converge beneath it. The assembled stack then moves into empty space in front of the capturer (lower field for the human, upper field for the computer), pauses briefly, and only then shrinks toward the captured-card area. This preserves the entire physical card stack until collection. The turn banner now displays only **Your turn** or **Opponent's turn**, including during deal/capture transitions. Build card corner ranks and suit symbols share a common baseline and rank-column width for consistent shoulder alignment.

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
Menu joins Exit on the left; the computer score occupies the middle of the toolbar, with Hint and Undo on the right. The new build panel starts invisible and fades in over 140 ms after landing; the next turn waits for it. Extended builds retain the previous panel until incoming layers cover it. Multiple-build group boundaries use a dark top border fading into the regular outline. Surviving table cards wait 160 ms after capture movement begins before sliding into gaps; CPU captures include the card-flip delay.

### v0.5.22 — selection colors
The build value and owner use pure white ink on a permanently black panel. Selecting a build turns the ink the same pale yellow as the selected card paper. Cards and builds use their existing physical borders in gold, without additional stacked outlines; multiple-build separators remain dark and blend into the gold edge. Selection paper and border fade together when cards move.

### v0.5.23 — cycling hints and capture clearance
Hint taps cycle through distinct legal hand/table selections, captures first, builds next, and trails last, then wrap around. Every action for a selection appears in the ordinary contextual controls; no special hint marker or outline. The lazy exact-selection search is independent of AI difficulty and its move-count limits. Human captures land beneath the lowest table cards with a measured gap, using the full card size where space allows. Existing CPU capture spacing and delayed table reflow are retained.

### v0.5.24 — clean empty table
Removed the dashed empty-table placeholder and its unused sizing rule. The felt is uninterrupted when no table cards remain.

### v0.5.25 — cleaner hand results and final collection
Category leaders use bold numbers without colored cells; ties are unbolded. Remaining table cards gather and travel to their recipient at their existing size, fading instead of shrinking. Final trails continue from their actual landing transform.

### v0.5.26 — trail artwork continuity
Human and computer trails use the same actual-dimension animation as build cards. The face is laid out at its true intermediate size, and the moving card ends with exactly the destination's dimensions and border-box sizing. This avoids a last-frame corner-index shift caused by scaling a smaller card face. The final landing becomes the new origin for end-of-hand collection, with no shrink or size reset.

### v0.5.27 — thinner multiple-build dividers
The dark divider recolors only the normal 1 CSS-pixel straight top border. It fades horizontally to the underlying grey or gold outline before either rounded corner, with no thicker border or shading down the sides. The identical rule applies to settled and moving group boundaries.

### v0.5.28 — exact border and capture size
Every full-size card uses identical clipped border geometry. Multiple-build dividers darken only the existing border, tapering over 2px before the 2px corner. The black panel seam is grey unless selected. Capture sizing excludes departing build layers and compresses overlap before card size; collection scales the assembled pile uniformly.

### v0.5.29 — independent build reservations
Each separate owned build must be backed by a distinct physical capture card remaining in hand. A single King cannot reserve two independent builds of 13; adding a group to one multiple build still requires only one King. The shared legality validator uses matching assignments for alternate-valued Royal cards, and applies to building, raising, capturing and trailing, including AI and hints. Pirate Builds still permits separate builds when all obligations can be met. The explicit Build To Anything exception remains unchanged.

### v0.5.30 — smoother animation
Build/trail faces are laid out once at exact destination dimensions and moved with compositor-friendly transforms. Capture, build, residue and deal staggers run on the Web Animations timeline instead of per-card timers. Layout measurements are batched, selected artwork fades as an opacity-only overlay, and synthesized audio buffers are cached. Existing destinations, delays, durations, turn gating and game rules remain unchanged. Frame rate remains dependent on the device/browser.

### v0.5.31 — polish and maintenance
Selection and hint changes update only card classes and legal-action controls; menu operations leave the live board and animation destinations mounted. Unnecessary validation, duplicate persistent saves, concurrent version checks, and uncancelled flight animations are eliminated. The offline cache has four canonical asset entries rather than accumulating query variants. The engine rejects impossible partition sums early, memoizes failed subproblems, prunes alternate-value combinations, and finds the same AI maximum without sorting. No legal move, scoring, hint ordering or AI strategy changes are intended; the prior proposal to merge raised independent builds is not included pending rule confirmation.

Retained table elements cancel superseded translations before starting a new one, preventing rapid-selection animation buildup. Dialogs are layered above in-flight cards. The partition failure cache is capped at 4,096 entries per search.

### v0.5.32 — build obligation, raise-and-merge, Hard and Expert
Build Obligation replaces the inverse Build To Anything label; saved flags retain their meaning. Raise one single build using a hand card and merge existing matching builds into a multiple build without breaking groups. The contextual menu can include the player's matching build automatically. Hard and Expert share public-information sampling, constrained by build obligations, a strategic score evaluator, and bounded iterative lookahead. Expert searches deeper and can solve small known-hand endgames exactly when the budget permits. Advanced AI runs in a cancellable offline-compatible worker and never receives the actual hidden hand or stock. Easy/Medium retain their previous search strategy. Worker failure or timeout falls back to a cheap legal move.

### v0.5.33 — uninterrupted opponent motion
Prepaint both sides of the opponent's card; native two-sided rotations replace the old midpoint HTML swap. Trails are prepared at landing size before flipping and use a common animation clock. Each capture runs a single compositor track including staggered gather, the 125 ms hold and simultaneous collection, with no JavaScript-triggered movement handoff. Snapshot geometry is measured once and end-of-hand residue markup is copied only when needed. The final collection fade now begins with the collection movement rather than late in it. Game rules, AI, card artwork and destinations are unchanged.

The CPU trail and capture tracks use a gentler zero-velocity start/end easing and a shared 16 ms paint lead; native refresh-rate timing remains uncapped.

### v0.5.34 — touch selection and difficulty layout
Removed legacy hover lifts from hand cards, table cards and builds. Only the selected class controls elevation; deselection returns to the normal position with a short transform transition. Selection updates no longer run a second FLIP movement or measure the board unnecessarily. The four difficulty choices appear in one horizontal row. CPU animation paths and gameplay rules are unchanged.

### v0.5.35 — concurrent thinking and matching animation rhythm
The opponent starts calculating the committed position as soon as the player's flight is scheduled (also during an opening/replacement deal). All four difficulties use the public-information worker where supported; Easy/Medium retain their scoring policy. Hard/Expert publish completed search iterations. The visible pause is 600 ms after the player's action and any dealing complete; at the deadline the CPU uses the best completed legal result and cancels remaining work. Undo/new match/exit discard obsolete searches. Both players use 490 ms trails, 340 ms capture gathering, 125 ms hold, 280 ms collection, 310 ms build flights, identical easing and staggering. The CPU retains its 335 ms face-down reveal. No rules or scoring changes.

## Fishing Lab 0.6.0 — custom rules and compatibility

Basic and Advanced rules share one configuration. Advanced controls cover deck/deal, capture, build and turn mechanics. The validator distinguishes static conflicts, warnings and not-yet-implemented features; the latter cannot be started. The rules laboratory runs ten deterministic deals using the actual engine, checks card conservation and build obligations, and retains failure diagnostics. The existing installation URL, storage keys and saved match format remain compatible. Planned mechanics include multiplayer, jokers, bid phases, multiple hand cards/actions per turn, and captured-pile stealing. The simulator samples deals, not a proof of all possible states. Subtractive building supports a two-card difference or lowering one single build; broader Zwicker arithmetic is not claimed.

### 0.6.1 — rules menu redesign

The Basic view is a quick-start preset, difficulty and common-rules editor. Advanced groups are collapsible and summarize their current configuration. Duplicate legacy face/ace/dealing controls are consolidated; the underlying saved rule flags remain compatible. The editor remembers dependent preferences when a parent rule is off and removes inactive effects from the actual game configuration. Compatibility is visible in the fixed footer, with expandable explanations and review links. Unimplemented modes appear only as an informational note, not as selectable game rules.

### 0.7.0 — fishing-game catalog and unified rules

The grouped native dropdown contains 66 games plus Custom; 12 playable profiles and 54 selectable research previews. Preview entries explicitly block Start, and known supported subsets may be copied as Custom. Four of the six focus games still require engine capabilities: Zwicker, African Casino, Seep and Hungarian Kaszinó. Suipi uses an eight-card two-deal version; Diloti uses six cards; Kontsina uses cumulative scoring; Tablić/Tabinet use end-of-deal scoring (ceremonial cut and exposed bottom card omitted); Scopa uses a French-suited 40-card deck. The single-page setup removes duplicate Basic/Advanced controls and explains CPU difficulty. Sources: https://www.pagat.com/fishing/diloti.html, https://www.pagat.com/fishing/tablic.html, https://www.pagat.com/fishing/scopa.html, https://www.pagat.com/fishing/kontsina.html, https://www.pagat.com/fishing/casino.html, https://www.playsuipi.com/how-to-play-suipi/.

### 0.8.0 — custom decks and capture values

Deck selection: 40 (A–10), 52, 54 (two identical jokers), or any subset of the 54 physical cards. Old Italian 40-card presets and saved matches retain their original composition using an explicit custom deck. Jokers have independent physical IDs but identical appearance and a shared numerical value assignment; no special joker capture powers are implied. The hand-size slider ranges from one to floor(deck size/player count); the validator separately accounts for initial table cards, final deal rules, and opening restrictions. Individual numerical values (1–30, optional second value) override standard settings while enabled. Rank-only preserves non-numerical face cards. Custom assignments and deck selection persist when switched off. The CPU, hint generator, legality checks and card conservation use the actual deck and values. Every info control explains the relevant options separately, and independent builds are clearly distinguished from mandatory equal-value merging. Difficulty descriptions appear only when info is expanded. Existing research-only presets remain blocked.

### 0.8.1 — rule terminology

Renamed the switches to **Builds must absorb matching table cards** and **Builds must combine matching builds**. Player-facing help, validation and accessibility labels now refer to table cards instead of loose cards. A table card in these settings means an individual, unbuilt card. Internal state identifiers and game mechanics are unchanged for save compatibility.

### 0.8.2 — revised build labels

The build requirements are now named **Builds must combine same-value table cards** and **Builds must combine same-value builds**. Their behavior remains unchanged.

### 0.8.3 — typed hand size and capture terminology

Cards per hand can be set with the slider or the editable integer box. Typing keeps the slider, deck summary, custom preset selection and compatibility status synchronized; out-of-range values are clamped on commit. The capture toggles now distinguish single card matches, sum captures and single builds used within a capture sum. Multiple builds must still match the played card exactly. Multi-group captures remain separately configurable.

### 0.8.4 — building controls and custom value limits

Construction settings remain together and are disabled rather than hidden when building is off. Addition, subtraction, multi builds and single-hand-card builds are independently configurable. A custom inclusive build range has editable numerical endpoints and dropdowns drawn from the selected deck’s available values; bounds adjust to available values when card values or deck composition change. Raising and lowering require both the applicable arithmetic setting and the appropriate owner-specific permission. Existing rules and saves default to additive building enabled. No new game presets or non-French deck types are introduced.

### 0.8.5 — negative builds, color arithmetic and scoring help

Negative builds are an opt-in extension to subtractive building: a 3 minus a played 7 can produce a displayed −4 single build with capture magnitude 4. All build obligations, same-value combining, capture sums, build ranges, and subsequent modifications use the positive magnitude. In color arithmetic, clubs/spades and the identical jokers add; hearts/diamonds subtract in arithmetic groups. Individual cards used as singleton groups retain their normal magnitudes. The addition and subtraction switches continue to govern allowed arithmetic. No zero-valued builds. Scoring system precedes sweep settings, and its info panel shows one scoring category per line, generated from the actual selected scoring specification.

### 0.8.6 — player setup and seating previews

Player Setup precedes Deck & Dealing. The stepped slider selects 2–6 players; the Teams dropdown offers free-for-all for every count, pairs for even counts, and triples for six. Seat zero is the human at the south end; teams alternate around the table and use blue, red and green. Two-player pairs have one team and no opponent. Player count updates hand-size limits, deal validation and setup summaries. Legacy four-player partnership profiles migrate to four players with pairs. Multiplayer arrangements are selectable previews, not playable modes: only two-player free-for-all can start a match. No change to saved two-player match behavior.

### 0.8.7 — polar seating preview

The seating diagram now consists solely of equal-sized annular-sector seats around a blank center. Each seat retains the same radial thickness and angular width at every player count (2–6), and seats are evenly distributed around the circle. Team colors and the southern human seat remain unchanged. This is a visual setup change only; multiplayer gameplay remains unavailable.

### 0.9.0 — rules audit and stable seating

Constant-size polar seating preview; shared rule dependencies with retained editor preferences; validation for impossible captures and missing scoring categories; corrected direct-priority/build obligations and uneven dealing. Corrected Wippen sweep scoring. Nine more playable profiles using existing rule controls and regional scoring choices. See [the rule audit and roadmap](docs/rule-roadmap.md) for sources, fidelity notes, deferred mechanics, and reproducible test instructions.

### 0.9.1 — extended gameplay regression audit

Adds reproducible full-match, search-based CPU, mixed-deck gameplay and player/deal compatibility matrices. Run `node --test tests/gameplay-matrix.test.cjs` or `npm test`. This test release preserves v0.9.0's game rules and fixed seating geometry. Three-to-six-player arrangements are tested for setup, not played; they remain blocked until a multiplayer engine is implemented.

### 0.10.0 — playable multiplayer against CPUs

2–6 seats, free-for-all, four/six-player pairs, six-player triples. Two-player Pairs removed. The engine rotates turns and dealers, supports batch/draw/full/uneven deals, scores pooled partnership captures and sweeps, and handles tied leaders. Builds and reserve obligations remain individually owned; teammates may capture or modify builds under the existing rules. With sweep cancellation and three or more sides, subtract all opposing sweeps from each side's count, flooring at zero. Hard/Expert sample every hidden hand, respect distinct physical-card obligations, and use a team-aware coalition search (not an exact multi-opponent equilibrium). CPU seats, turn indicators, deal/capture animation destinations and multi-side results are shown on the game screen. Local and online human multiplayer are not part of this release. Partnership Cassino and both Scopone profiles are enabled; Five-player Cassino uses an explicitly named unequal-final-deal house rule. Changing player count automatically selects unequal final deals when necessary.

### 0.10.1 — player arrangement labels

Player Setup displays 1 vs. 1 for two players, FFA for three to six individual players, 2 vs. 2 for four-player partnerships, and 2 vs. 2 vs. 2 or 3 vs. 3 for six-player teams. The info button describes only the available arrangements and their scoring/team relationships, including during slider adjustments. Internal rule keys, seating geometry and saved matches are unchanged.

### 0.10.2 — named custom variants and fit-to-row cards

Save as new variant in the Game variation section stores a named snapshot of the full draft (including custom decks, card values, difficulty, and inactive preferences). Multiple named variants appear in a Saved variants dropdown group. Update saved can also rename; Delete saved removes only that library entry and retains the current draft/game. Invalid custom drafts may be saved for later correction, but Start remains subject to compatibility validation. Research-only presets cannot be saved as complete playable variants. Storage is device-local, uses a new key, and never overwrites an existing entry without an explicit update. Legacy unnamed custom rules and existing saved matches are retained. Card layout is a separate persistent preference in setup and the in-game menu: Scroll / wrap preserves the previous layout; Fit in one row shrinks hand cards and individual table cards to fit their lanes without wrapping or horizontal scrolling. Builds retain their own lane. Very large rows may make cards small. No engine rules changed.

### 0.10.3 — compact gameplay HUD and direct row toggle

The game toolbar cycles between One row and Multi row. Both fit all hand cards and table cards without horizontal scrolling; the old scroll/wrap preference migrates to Multi row and fitRow to One row. Card sizes are physical, responsive dimensions with a height budget for dense hands. A stable turn/action strip places the turn indicator above legal move buttons. The player's score badge is centered vertically between the hand and bottom stats, with the same blue team accent as the CPU teammate. CPU panels retain name, points and card backs, but remove redundant visible card counts and team names. Saved variants and game rules are unchanged. Switching layout is disabled while a CPU or animation is acting, preserving card-flight geometry.

### 0.10.4 — direct team arrangement control

Tap Teams to cycle through the available arrangements for the selected player count. Single-arrangement counts display a fixed value; the info button remains available. The seating preview updates immediately and uses seat colors alone to communicate teams, without a redundant legend. Saved variants and game rules are unchanged.

### 0.10.5 — automatic two-row hand and turn cue

The hand keeps a fixed two-row height and consistent card size/gap. One row is centered; the second fills only when necessary. After both rows fill, added cards alternate between rows, with dynamic overlap and exposed corner indexes. The 54-card full deal is supported without changing its 27-card maximum. Old layout preferences are ignored; table cards retain automatic non-scrolling rows. Inactive hand faces dim until the human can actually act. Capture is shortened and action buttons share one line, reducing horizontal padding rather than label size (horizontal overflow remains accessible for unusually many custom build choices). No engine, saved match or variant rules changed.

### 0.10.6 — hand sorting

The top-bar sort button cycles between Suit → value and Value → suit. The default is suit first, and the preference persists locally. Suits order S, H, C, D, then jokers. Values ascend using the minimum numerical value assigned by active rules; rank-only cards use their printed rank for sorting only. Ties use the other sort key, then printed rank and card ID. The sorted view reads across the top row then the bottom row, including overlap, without changing the engine hand order or selected card identity. The button is disabled while it is not the human's actionable turn so card-flight destinations cannot move mid-animation.

### 0.10.7 — sequential hand dealing and selection polish

Human cards fly into the slot for the number of cards dealt so far: fill the top row from left to right, fill the bottom, then append alternately to top and bottom with row-specific overlap. Already-dealt cards glide into the next layout during landing. Replacement draws also append to their incremental slots. The completed hand returns to the selected rule-aware sort order at the next-turn render. Selected loose cards lift 5px (builds 6px) with a smooth 190ms transform; card-local touch highlights follow the card's original stacking order. The rules engine, CPU timing and table-card flights are unchanged.

### 0.10.8 — compact sort labels

The hand-sort toggle displays only 555 (suit first) or 567 (value first). Accessible descriptions and rule-aware sorting are unchanged.

### 0.10.9 — two-player deal landing fix

Both two-player and multiplayer deals now use the same identity-bearing human flight targets. Previously the two-player branch omitted the human card ID, causing flights to land at the default hidden-card position instead of their incremental hand slots. Regression tests exercise actual deal target generation and drive the animation callbacks through a 26-card deal and a replacement draw. The selected sort order still applies after dealing finishes.

### 0.10.10 — smooth turn-state hand tone

The isolated hand layer fades between its normal and inactive grayscale/brightness levels over 160 ms, carrying the currently displayed filter across game redraws. Reduced-motion and disabled-animation preferences are respected. Turn timing, card positions, and legal moves are unchanged.

### 0.10.11 — fixed-slot dealing and dealt order

The hand uses its actual final card count, including hidden incoming cards, to precompute final two-row positions and overlap. Cards fly directly into the top row left-to-right, then the bottom row left-to-right, and never move again during the deal. Default sort is dealt (original receipt order); the toolbar cycles dealt → 555 (value first) → 567 (suit first). The selected display order determines landing positions, so there is no final reshuffle. Cards are full-color during dealing, with turn-state dimming only during normal play. The launcher emblem is inset within the maskable icon safe area.
Two-player play uses blue for the human and red for the CPU, in setup and the score badge. Independent CPUs are grey only in 3–6-player free-for-all; partnership colors remain unchanged.

### 0.10.12 — fixed team option alignment

Single-arrangement team controls (2, 3, and 5 players) use the same left alignment and padding as cycling team controls, without showing a cycle icon or enabling interaction.

### 0.10.13 — in-game settings, restart and four-column table

The in-game Settings dialog contains playback return, move history, sound, undo, restart and a bottom Exit to menu action. Game setup and animation preferences remain accessible from the main menu only. The static How to play shortcut is hidden until rules-aware help is available. Exit confirmation also offers restart using the same rules, with existing new-match confirmation. All selectable loose cards and builds use the same smoothly animated selection feedback; table buttons are disabled while input is unavailable, and build flashes stay within their own stacking context. The loose-card lane always has four columns, with the right build lane reserved even when empty, and both lanes are positioned slightly lower. Very large tables use additional rows and smaller cards rather than overlapping the build area.

### 0.10.14 — bounded builds and temporary CPU playtesting

Full-size builds remain expanded while they fit in the measured build lane. If their combined height exceeds the lane, they switch to one-card black summaries showing owner, value, single/multi and card count. Selected summaries open shadowed full-card previews within the table; tall previews and crowded summary lanes scroll rather than covering hands. Capture/build flights use the visible summary or expanded preview for collapsed piles. Temporary CPU-only restrictions in setup and in-game Settings independently disable captures, builds and resulting multi-builds. Restrictions are local preferences, not saved variant rules. The normal AI is unchanged when switches are off; the restricted worker uses filtered candidate scoring and legal fallback. When no legal move satisfies the restrictions, the CPU stops with a recovery message and settings can be changed before resuming.

### 0.10.17 — animated full-stack ribbon previews

A highlighted collapsed build fans each real card vertically from its original summary in a staggered, reversible ribbon spread. The preview floats over the full game felt with individual card shadows and no scroll viewport or clipping. Preserve ordinary card dimensions and spacing whenever possible; compress the exposed spacing, and only if necessary the preview card width, to display exceptionally long stacks in full. Multiple highlighted previews prefer non-overlapping horizontal positions. Ordinary build packing and the actual game rules are unchanged.

### 0.10.18 — opaque ribbon closing and softer inactive cards

Closing build ribbons remain fully opaque while their geometry reverses. Disabled preview buttons no longer inherit the global disabled-button opacity. Inactive hands use reduced saturation and contrast with a mild brightness lift, preserving red/black suit distinction and the existing 160 ms turn fade.

### 0.10.19 — raised capture and residue collection

Collection cards lift slightly with a soft shadow, converge at a uniform 106% of the normal responsive card width, and retain that size throughout gathering and the brief hold. Only the final flight toward the score box smoothly shrinks and fades the stack. The gathered stack may overlap the table instead of shrinking to available green space. The same lift and shadow apply to the end-of-hand residue. Capture timing and game rules are unchanged.

### 0.10.20 — shoulder-safe adaptive build spacing

Measure each build's actual rank-and-suit shoulder index and compute its tightest safe vertical spread, leaving a pixel of clearance. Try the standard spread, then tighten enough to keep builds in the primary column; borrow a second column and only collapse builds when necessary. Recalculate the freed height and positions on every layout, restoring natural spacing when space becomes available. The physical cards and game rules are unchanged.

### 0.10.21 — reference-style gray inactive hand

Inactive hand artwork uses an 80% brightness filter, matching the supplied reference's #CCCCCC card paper while preserving black and red suit contrast. The existing 160 ms turn fade, full-color deal and interaction timing remain unchanged.
