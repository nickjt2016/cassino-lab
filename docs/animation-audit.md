# Animation audit — v0.10.23

Reviewed 28 November 2026. Production changes were published in commit `5f58bf31638bc2bcedb9a0fa7000c8d2fe9fd69c` and verified on the live GitHub Pages game. The rules engine and sound assets were not changed by this animation release.

## Findings and repairs

| Area | Problem found | Repair |
|---|---|---|
| Loose table cards | Gutters changed at six, ten and eighteen cards, so a capture could abruptly change spacing. | Keep a four-pixel gutter while row count and available card size adjust. |
| Card rearrangement | Position snapshots stored centers only. A surviving card could jump to its new size before moving. | Save the full rectangle and animate both translation and scale, including changes in size with no change in center. |
| Multiplayer opponents | Retained card backs animated only in the two-player layout. | Track and animate backs by CPU seat and position within that seat. |
| Build rearrangement | Stack spacing, column moves and expanded/collapsed transitions could snap. | Animate retained physical layers individually and use source-size card layers when folding into a summary. |
| Build clipping | A lane could shrink before cards returning from its second column finished moving. | Allow the moving layers to cross the old bounds during reflow, then restore the normal overflow rule. |
| Build inspection ribbons | Closing a neighboring ribbon could cause another open ribbon to refit and jump. | Keep an existing ribbon's placement unless its own anchor or available table bounds changes. Reserve the closing ribbon's space until it is gone. |
| Crowded hands | Compressed corner indices could switch instantly to the normal flight artwork. | Preserve the source face and blend it into the ordinary card face over 160 ms. |
| Settings and other persistent dialogs | A completed turn could replace a mounted dialog, replaying its entrance and losing focus or scroll position. | Replace the board while retaining Settings, Exit and Soundboard dialogs; refresh controls whose enabled state depends on the turn. |

The existing player/CPU rhythm, CPU reveal, capture staging, full-size final residue gathering and hand-tone treatment were preserved. Normal move flights remain above build reflow layers; dialogs remain above both. Cancellation cleanup is guarded so an older animation cannot remove a newer animation's tracking handle or leave a target hidden.

## Automated verification

`npm test` passed **270 of 270 tests**, with no failures, cancellations or skipped tests. Nine added regression cases exercise full-rectangle continuity, size-only changes, seat-specific CPU identities, hidden deal targets, constant gutters, per-layer build movement, fold geometry and cleanup, interrupted cleanup, and reduced motion.

The starting checkout passed 250 of 261 tests. The eleven existing failures were stale fixtures or assertions tied to older UI/function signatures. These were updated to check the current behavior, including the hand as the turn cue, multiplayer labels, signed build values and current deal parameters. A further render-order assertion was updated for the two new board-replacement branches. The behavioral hand-tone checks were retained.

Build generation, JavaScript syntax checks and whitespace/error checks also passed. A second review found no remaining blocker in the production changes.

## Browser verification

The isolated [browser runner](../tests/animation-browser.html) loads the actual game source into an opaque-origin sandbox. Its temporary positions do not read or overwrite saved matches. The runner supports paused frames, seek controls, explicit redraws, Undo and repeatable deals.

Each of these eleven scenarios ran at all five viewport sizes:

| Scenario | Main behavior checked |
|---|---|
| Table gap | Capture across the former seven-to-six-card spacing boundary |
| Player trail | Card flight and remaining-hand rearrangement |
| CPU trail | Face reveal, travel and retained CPU backs |
| CPU capture | Reveal, capture staging and delayed gap closure |
| Multiple CPUs | Separate seat identities and hand movement |
| Dense table | Twenty loose cards, capture and responsive rearrangement |
| Build | Construction flight and stack creation |
| Crowded builds | Capturing a large build while the remaining columns repack |
| Inspection ribbons | Opening and closing selected collapsed-build previews |
| Crowded hand | A twenty-six-card hand and a departing card |
| Final residue | Last play, collection of the remaining table and result dialog |

| Viewport | Scenario results | Fresh deal |
|---|---|---|
| 320 × 568 | 11 completed | Completed |
| 360 × 640 | 11 completed | Completed |
| 390 × 844 | 11 completed | Completed |
| 844 × 390 | 11 completed | Completed |
| 1280 × 800 | 11 completed | Completed |

All **55 scenario runs and five fresh deals** settled with zero remaining flight elements and zero hidden card faces. The game viewport did not develop horizontal or vertical page overflow, and the fixture reported no application errors. A few layout effects correctly continued briefly after the main move callback; the settling checks waited for those effects to finish before checking cleanup.

Additional checks confirmed:

- Undo during a paused CPU capture cancelled the motion and restored the prior state without residual flight layers.
- Settings retained the same dialog identity through an explicit redraw and completion of the pending move.
- The live game, outside the fixture, resumed a saved match on v0.10.23, accepted a normal capture, completed the CPU response with Settings open, and restored the original hand/table through Undo.
- Paused capture frames and screenshots of crowded stacks, phone layouts and the landscape results dialog were inspected for layering and clipping.

The runner was subsequently tightened so each fixture starts from a clean, stationary scene, its geometry baseline is refreshed at the moment of action, and every report identifies its command and revision.

## Scope and limits

These results establish the repaired behaviors in the automated suite and the tested desktop Chromium browser at the listed viewport sizes. They are not frame-rate benchmarks or a physical-device Safari/iOS certification. Actual phone hardware and a viewport rotation during an already-running flight were not verified in this pass. The fixture's large artificial builds stress presentation; their declared values are not examples of canonical build arithmetic.

The browser runner is a developer aid, not part of the game's navigation. New fishing-game mechanics are researched separately in [the expansion roadmap](fishing-expansion-roadmap.md).
