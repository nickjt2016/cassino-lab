# Rules audit and implementation roadmap — v0.9.0

Current gameplay is two-player competitive play. Multiplayer arrangements remain configuration previews. This release adds no new general-purpose rule fields; the scoring selector gains regional profiles.

## Verified profiles
- Cassino with sweeps, 50-point Cassino, relaxed trailing, and single-build capture sums: documented options in Pagat's Casino rules. The single-build sums preset enables the capture rule, not the optional arithmetic construction rule.
- Connecticut / New York Cassino: most cards 1, diamond ten 3, spade two 2; other ordinary points unchanged.
- Wippen: corrected to score one point per sweep as well as two points each for card and spade majorities.
- Swedish Kasino: numerical faces, dual-value aces, no building, one point for most cards, two for most spades, one for the last capture, one per sweep, target 16. Uses the documented replay-on-tie variant.
- Överspader: Swedish Kasino with one point per spade beyond six, target 21, replay tied winning totals.
- Scopa to 21 points: documented alternative target.
- Hurrikan (single match): six-card hands, heart bonuses, prime J=8/Q=9/K=10, target 16. German descriptions are ambiguous about opening restrictions and final sweeps; this profile allows the final sweep and does not require a three-king redeal. Double-game settlement is not modeled.

Preexisting Royal Cassino is a numerical-face house rule, not full Puerto Rican Royal. Suipi uses the selected eight-card/two-deal house rules; region-specific build protection varies. Tablić and Tabinet use end-of-deal scoring and omit the ceremonial cut, exposed bottom card and optional hand rejection. Diloti uses the current independent-build restriction.

## Dependency and compatibility checks
- Building off: disable all construction, modification, ownership and build-only capture controls; restore preferences when reenabled.
- No numeric values: construction controls inactive. Neither arithmetic method enabled: raising/lowering and color arithmetic inactive, but equal-value multiple builds and single-card declarations may remain enabled.
- Subtraction off: negative builds inactive. Multiple builds off: combining/absorbing mandatory equal-value groups inactive. Sum capture off: using builds in capture sums inactive.
- Direct capture off: direct priority and compulsory direct capture inactive; unavailable compulsory mode falls back to optional. Both table-card capture methods off: block Start.
- Missing face cards, aces, special cards or jokers: corresponding value controls inactive. Custom values override standard value controls.
- Full deal disables hand-size editing; draw replacement disables final batch restrictions; fixed match length disables target score.
- Zero sweep points: scoring-related sweep switches inactive; extra-turn rule still matters.
- Invalid team arrangements, insufficient cards, incompatible deal remainders, impossible starting restrictions and impossible active build ranges: block Start.
- If no construction or capture is possible and no residue goes to a player, a target-score match cannot end: block Start. A fixed-length match may end in a scoreless tie; warn instead. Missing scoring cards or suits: warn, rather than arbitrarily blocking intentionally customized scores.
- Direct-match priority is applied only to otherwise legal matches, so reserved capturing cards cannot become unusable.
- Unequal final deals award the extra card to the non-dealer.

## Earmarked parameters and capabilities (not implemented)

| Capability | Relevant variations |
|---|---|
| Actual 3–6-player and partnership engine, team scoring, partner build obligations, direction of play | Cassino, Scopone, Seep, Diloti and more |
| Separate hand/table values | Finnish Kasino |
| Mandatory inclusion of every direct match, compulsion across an entire hand, stricter build-card reservation | Puerto Rican Royal, Suipi house rules |
| Multi-card hand actions, multi-action turns, table-only building, construction arithmetic using existing builds, table-wide house limits, shared ownership and protection stages | Hungarian Kaszinó, Swazi Casino, Seep, Esun |
| Opening bid, initial card choice, predetermined starting table, variable deal packets, excess stock disposition | Seep, Chkobba, Eléwénjewé, Scopa Corse |
| Fixed-total captures, special clearing cards, sequence captures | Escoba, Pâsur, Basra, Žandari, Ronda, Cuarenta, Chinese Ten |
| Stack/pile stealing, exposed pile information | African Casino, Casita Robada, Pişti, Xeri |
| Sweep size/phase/score thresholds, general last-capture bonus option, score-difference and reverse scoring, early victory claims, endgame category restrictions, tie-breaks, double-game settlement | Finnish/Royal Casino, Krypkasino, Hurrikan, Tuxedo |
| Fixed round-win scoring, per-card totals, elimination, declaration bonuses | Kontsina, Eléwénjewé, Scopa Bazzica, Cirulla |
| Multiple physical copies of French-suited cards | Mulle, Krypkasino |
| Distinguishable jokers or non-translatable cards | Excluded under the current deck restriction; full distinct-valued-joker Zwicker remains unavailable |

## Sources
- https://www.pagat.com/fishing/casino.html
- https://www.pagat.com/fishing/royal_casino.html
- https://www.pagat.com/fishing/nordic_casino.html
- https://www.pagat.com/fishing/scopa.html
- https://www.pagat.com/fishing/diloti.html
- https://www.pagat.com/fishing/kontsina.html
- https://www.pagat.com/fishing/tablic.html
- https://www.pagat.com/fishing/elewenjewe.html
- https://www.pagat.com/fishing/seep.html
- https://www.playsuipi.com/how-to-play-suipi/
- https://www.playsuipi.com/how-to-score-a-suipi-game/

## Reproduce testing
Run node --test tests/rules-audit.test.cjs or npm test. Tests cover dependencies, blocked configurations, scoring fixtures, preserved editor preferences, reserved-card capture priority, non-dealer deal order, stable seating markup/CSS, and a deterministic randomized matrix. Simulated deals test termination of a deal, legal moves, and card conservation; they do not prove every possible game configuration or physical phone rendering.

## Extended audit (v0.9.1)

- 100 additional randomized rule configurations use 40-, 52-, 54-card and arbitrary custom decks, varying hands, opening table, dealing mode, remainder handling and card values. Two complete CPU deals per valid configuration.
- 42 complete matches across the 21 playable profiles, one Easy and one Medium per profile. Verify legal moves, conservation, score accumulation, dealer rotation and actual victory/finish conditions.
- Eight search-based full deals across Classic, color/subtraction Royal, custom-valued jokers and Scopa at Hard and Expert. Reduced deterministic node budgets test legal completion, not device speed or full-strength play.
- 1,296 setup compatibility combinations cross player count 2–6, all permitted team modes, deck type, opening table, deal method and remainder policy. These are static setup tests, not actual multi-player games. Two-player pairs and all three-to-six-player matches remain unplayable.

See `tests/gameplay-matrix.test.cjs` for the seeded reproducible audit. Browser touch interaction, phone layout, and full multiplayer gameplay are not certified by these tests.

## Multiplayer implementation (v0.10.0)

Actual 2–6-seat CPU gameplay is now available, including pairs at four/six seats and triples at six. Team totals are computed from pooled captures. Build ownership and reserve cards remain individual; shared house ownership and protection (Seep and some regional games) are deferred. The two-player-only statements above describe earlier releases, not the current engine. Hard/Expert use public-information sampling and team-aware search; for multiple competing sides their coalition model is approximate. No exact-endgame claim is made when hidden cards are distributed across multiple opponents. Player-to-player networking, hot-seat human play, additional physical packs, distinguishable jokers, and other catalog blockers remain deferred. Scopone references: https://www.pagat.com/fishing/scopone.html and https://www.pagat.com/fishing/casino.html. Five-player unequal-final-deal Cassino is a house-rule profile rather than a claim of historical fidelity.
