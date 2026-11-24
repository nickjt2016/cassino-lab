# Cassino Lab — gameplay reference checklist

The user supplied video files **1000063672.mp4** (26.8s) and **1000063673.mp4** (12.4s), recorded from Michael Dokken's Cassino game. These recordings are visual interaction references; use original Cassino Lab code, graphics, sound effects and UI assets, while reproducing the observed functional layout and motion. This checklist must be reviewed whenever gameplay rendering changes.

## Reference blocking: one-screen table

- Player/opponent areas remain fixed: opponent's compact blue-backed hand near the top, player's face-up hand near the bottom, statistics panel at the foot of the felt
- Stock is at the left edge, loose table cards occupy a middle-left lane, and physical build piles occupy a right-hand lane
- The four initial loose table cards fit horizontally at phone widths 320, 360 and 390px; don't push the build pile into the loose row
- Do **not** relocate a build to above the card row, recenter loose cards abruptly, hide other table cards or let a rendered card overlap the stock pile
- Keep the felt playable in a single viewport including 844×390 landscape; more than four loose cards may wrap into additional rows
- The green felt stays largely unobstructed, with a short move message in the open area rather than an always-visible action footer

## Reference animation

- **Deal** (first recording ~7–10s): cards originate from the stock, travel **face-down**, reveal their faces on reaching the table/player hand, and synchronize with a rapid paper-card riffle sound
- **Trail** (first recording ~18–25s): selected player card highlights yellow; a short contextual button appears; the card moves from hand to a proper table-card-sized slot; computer card flips face-up before leaving the opponent's hand
- **Build and extend** (second recording ~6–10s): individual real cards slide into a straight vertical solitaire-like stack on the right, revealing each rank/suit index; no separate build-tile icon is substituted; the stack does not fan horizontally
- **Build badge**: one black owner/value panel sits flush across the lower ~65% of the front card and appears *after* the physical cards settle
- **Build cadence**: the extension in the recording settles over roughly 0.5s; current flights start 48ms apart, last 310–365ms and end with a short value-label transition
- **Capture**: the capturing card is shown face-up above the selected cards; all cards, including the components of builds, gather beneath it and return as one stack to the capturer's pile, fading *only at the capture destination*
- **Final residue**: remaining cards are visibly awarded to the last player to capture before the score results appear
- Never cold-cut between a source card, traveling card and final card; do not allow existing table cards to disappear during draw-mode dealing

## Interactions and menu behavior

- Tapped cards highlight yellow only; show **Build [value] / Multiple Build [value] / Capture cards / Trail** when legally available; buttons vanish when deselected
- New Game preserves the main-menu scroll position
- New Game → Custom stacks the opaque Game Variations dialog above New Game without flashing the main menu; Back returns to the same New Game dialog
- Leaving an active game asks for confirmation; cancellation resumes exactly where the user was
- Releases update automatically at the main menu without interrupting an active game

## Regression screens and limits

Check at **320×568, 360×640, 390×844 and 844×390**. Verify four loose cards share one row with and without a two-card build, confirm a safe gap between the final loose card and the right-hand pile, and verify no main-page scrolling. Check an opponent trail, a single build, a multiple build, a capture, a redeal and the last-capture residue animation.

Cassino Lab currently approximates the reference from original assets and code; its exact typography, sound character and frame-level interpolation may still differ. Compare those deliberately rather than claiming pixel-for-pixel identity.
