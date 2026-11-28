# Fishing-game expansion roadmap

Research baseline: **Fishing Lab v0.10.22**, commit `d57ee86fea499c02b065d5a17eae60fffbb5724a`. Reviewed 28 November 2026.

The most valuable expansion is to complete **Seep**, followed by the distinct building systems in **Zwicker** and **African Casino**, the multi-card captures of **Hungarian Kaszinó**, and the duplicate-card tactics of **Mulle**. These develop the building, planning and hand-management aspects of Cassino. Smaller scoring and capture extensions can unlock several other families alongside that work.

This is a research and implementation roadmap. It does not enable new rules. The current catalog contains **73 entries: 25 playable profiles and 48 previews**. Those figures were checked against both catalog status and `validateRules(rulesFor(id)).playable`. A preview name identifies a research target; a playable preset means that its selected implementation passes configuration validation, not that every regional tradition has been reproduced.

## 1. What the engine already supports

The source in `src/engine.js` is the baseline. Earlier two-player-only statements in `docs/rule-roadmap.md` describe older releases.

| Area | Available now | Remaining boundary |
|---|---|---|
| Players | Two to six seats, CPU opponents, permitted pair/triple teams and pooled team scores. | Build ownership and reserve obligations remain individual. Turn progression uses one fixed direction. |
| Decks | Standard and custom subsets of one French-suited pack; up to two jokers. | One physical instance of each ordinary card; both jokers share a value configuration. |
| Values | Numerical faces, alternate ace values, one or two custom numerical values per card. | No separate hand/table value policy or declaration that changes a card's identity during a hand. |
| Captures | Direct matching, additive sums, one or multiple groups, chosen-card compulsion, maximal/maximum capture policies. | No complementary totals, sequence extension, special clearing powers, or general compulsion across every card in hand. |
| Building | Additive/subtractive construction, single-card declarations, multiple builds, raising/lowering policies and equal-value merging. | One owner and one target value; multiple builds cannot change value; no shared/protected house types or general table-only actions. |
| Dealing | Batch, replacement-draw and full-deal modes; selected opening restrictions. | No opening bid, arbitrary packet schedule or optional opening-card choice. |
| Scoring | Ten scoring schemes, sweep cancellation, opening/final sweep controls and fixed-length matches. | No general card-point map, declaration/event scoring, score-difference settlement or mid-hand victory claims. |

The core action accepts one `cardId`, one of `trail`, `capture` or `build`, and targets from the central table. Captured cards are a flat array. Those choices explain most larger gaps. Useful code entry points are `validateRules`, `validateAction`, `describeCustomCapture`, `capturePolicy`, `describeBuild`, `applyAction`, `scoreSpec`, `scoreHand` and `makeState`.

## 2. Small additions with broad value

These fit the existing table-and-hand model, although each still needs legal-move and AI support.

| Addition | Why it matters |
|---|---|
| Configurable card and event points | Supports special scoring cards, negative cards, same-suit captures, capture-size bonuses and previous-play bonuses. |
| Conditional sweep scoring | Separates clearing the table from earning points; conditions can inspect the capturing card, opening/final stage, capture size and prior score. |
| Contextual values | Allows a card to have different capture values in hand and on the table without changing its printed identity. |
| Additional capture predicates | Expresses restrictions on repeated ranks, permitted combinations and compulsory captures across the hand. |
| Captured-card combination scoring | Counts suit runs, complete suits, special sets and alternative prime comparisons. |
| Deal schedules and residue policies | Handles changing packet sizes, unused stock, table remainders and specific recipients of leftover cards. Opening table sizes also need broader support: validation currently permits only 0, 3, 4 or 8 cards, excluding five-card and ten-card openings. |

For example, **Cicera** retains familiar matching and sum captures but rewards capturing the previous player's card, taking cards all in one suit and capturing at least three table cards. This mainly needs scoring events rather than a new board model. Its captured-swords sequence also illustrates reusable combination scoring. [Cicera rules](https://www.pagat.com/fishing/cicera.html)

**Eléwénjewé** has a relatively approachable base profile: optional capture restrictions, scoring and residue handling. Its optional **Esun** extension is larger: protected piles, potentially several capture values and obligations to take a pile before a later deal. An ordinary immutable multiple build is not a complete implementation of Esun. [Eléwénjewé rules](https://www.pagat.com/fishing/elewenjewe.html)

## 3. Priority games for deeper building strategy

### Seep: complete houses, opening procedure and match scoring together

Pagat's main 100-point game begins with a 9–13 bid and a constrained opening play before the rest of the deal. Cemented houses can have opposing co-owners; adding for a partner need not transfer ownership. Equal-valued houses and eligible floor groups consolidate. The optional two-house restriction is table-wide. Two-player Seep has two successive twelve-card hands. The 30-point version has different scoring, setup restrictions and sweep treatment; lowering the target does not reproduce it. [Seep rules](https://www.pagat.com/fishing/seep.html)

The engine already supplies numerical houses in the right range, partnerships and several useful capture/build restrictions. Completion requires:

- An opening bid, opening-play and subsequent-deal sequence.
- House owner sets and partner obligations, reusing the existing fixed-value multiple-build behavior.
- Absorption of eligible sum groups, not just equal-valued individual cards.
- A global house limit, separate from the existing per-owner limit.
- The selected version's score difference, baazi settlement and sweep exceptions.

This is the strongest first major project. The current partial preset should remain explicitly partial until these rules work as one coherent game.

### Zwicker: mutable piles and distinguishable jokers

The Dithmarschen version uses three distinct jokers valued 15, 20 and 25, alternate face values and a 4/4/5 dealing schedule. Its construction changes one pile at a time; equal-value additions do not permanently freeze that pile. Built piles can be altered and included in capture sums. Another version uses six different joker values and different partnership communication. [Zwicker rules](https://www.pagat.com/fishing/zwicker.html)

Subtraction, alternate values and ordinary numerical jokers already exist. The missing work is a mutable pile type, construction-target policy, distinct joker instances, deal schedules and variant scoring. Partnership promises also need explicit rules for what a player may infer or ask.

Do not implement this by weakening all Cassino multiple builds. Cassino's fixed multiple build and Zwicker's mutable pile should be separate rule semantics sharing the same visual components.

### Hungarian Kaszinó: multiple cards from hand

The principal account describes a building-free game with three-card hands, where several hand cards can combine to capture table cards. Other recorded Hungarian versions change group arithmetic, opening-sweep rewards and turn order after sweeps; some also use early victory claims. These should be named profiles rather than blended. [Hungarian Kaszinó rules](https://www.pagat.com/fishing/royal_casino.html#hungarian)

The main missing primitive is a hand-card collection in the action rather than one `cardId`. That affects selection, validation, legal-action enumeration, AI search and animation. Existing logic that skips empty hands can help, but actions that spend unequal numbers of cards need their own scenarios.

The existing `extraAfterSweep` option is relevant to one documented Hungarian-book variant. It is not a universal requirement of every account.

### Mulle: physical copies and exact-card bonuses

Mulle uses two packs. Published versions differ: one rewards a restricted identical-card capture with a fixed bonus; Glimne's account permits additional captured cards and derives the bonus from the played card's value. The latter also distinguishes hand and table values and permits building. [Mulle rules](https://www.pagat.com/fishing/nordic_casino.html#mulle)

Add physical instance identifiers independently of suit/rank identity, then allow 104-card decks. Card conservation, saved states, public-information tracking and AI sampling must preserve that distinction. Exact-card capture events and contextual values supply the remaining foundation.

**Krypkasino** adds a reverse objective. Its scoring, winning conditions and AI evaluation must favor avoiding the relevant captures; merely changing a final score display is insufficient.

### African Casino: turn sequences and reusable captured cards

In the documented Swazi game, a turn can include table-only construction while still playing exactly one hand card. An opponent's exposed top captured card can augment an existing valid base; taking it exposes the next card. Captured-pile order matters, and some versions change restrictions as the deal progresses. Sotho has further differences in card handling and pile access. [African Casino rules](https://www.pagat.com/fishing/african_casino.html)

This requires the largest structural change among these close relatives:

- Ordered captured piles with controlled top-card visibility.
- Pile-top targets distinct from ordinary table targets.
- Several provisional actions within one turn, followed by a clear completion rule.
- Capture-order choices and ownership constraints.
- Phase-dependent restrictions and complete undo of the turn sequence.

These systems have broad reuse, but a generic “steal cards” switch would hide essential differences between regional games.

## 4. Additional variants absent from the catalog

These offer more variety without duplicating every already-listed preview. The source's specific rule version should accompany each future preset.

| Variant | Additional behavior |
|---|---|
| Re Bello | Bonus for taking the king of coins/diamonds. |
| Napola / Scopa con le Scalette | Captured-suit sequence rewards; selected versions award an outright win for a complete suit. |
| Asso Pigliatutto / Scopa d'Assi | Ace-clearing power with an ace-on-table exception; sweep rewards differ between versions. |
| Scopa di Quindici | Total-15 captures, sometimes combined with ordinary equal-value captures. |
| Scopa Bazzica | Competing revealed three-card declarations. |
| Sbarazzina / Piva | A combination of ace powers, declarations and extra scoring; Piva includes a negative scoring card. |
| Scopa Corse | A 36-card pack without twos, changing deal packets and optional captures. |

[Pagat's Scopa variants](https://www.pagat.com/fishing/scopa.html)

**Cirullone** is a particularly strong addition for planning: larger-hand Cirulla, with nine-card or staged six/three-card versions. A documented form requires declared three-card subsets to remain exposed and be played before the rest of the hand. Other groups allow freer play. It needs Cirulla's core systems, then selective hand exposure and temporary card obligations. [Cirulla and Cirullone](https://www.pagat.com/fishing/cirulla.html), [Cats at Cards](https://www.catsatcards.com/Games/Scopa.html), [Traditional Ligurian Card Games](https://sbiro.eu/eng/cirullone)

## 5. Broader families and their shared requirements

Most names below already appear as previews. Completing them means implementing the listed behavior, not adding another menu entry.

| Game/family | Missing capability | Scale |
|---|---|---|
| Escoba | Played card plus a selected group totals 15; setup-triggered captures and the chosen setenta scoring. | Major capture extension |
| Basra | Jack/diamond-seven clearing powers, conditional sweep rewards and tied-majority carryover. | Major capture/scoring extension |
| Pâsur | Total-11 captures; jacks clear selected ranks; sweep eligibility depends on deal stage and prior score. | Major capture/scoring extension |
| Cirulla | Combine ordinary and total-15 captures, ace powers, declarations and a dynamically assigned heart-seven value. | Major rules and information changes |
| Chorizo / Báciga | Hand-combination declarations; optional variants bank a whole hand or use assigned wild identities. | Major phase/declaration changes |
| Ronda / Cuarenta | Matching or permitted sums followed by sequence captures; previous-play bonuses and declarations. | Major capture/event changes |
| Porrazo | Wrapped sequences, pending captures that can be countered, and dealer-selected layout timing. | Structural response phases |
| Shlla'at | Steal top captured sets; keep drawing/playing after captures while stock remains. | Structural piles and turn phases |
| Ghârat | Capture top runs of equal cards from ordered central or capture piles. | Structural pile access |
| Pişti / Xeri | One central pile, top-card matching, jack powers and size-sensitive bonuses. | Structural board mode |
| Mitaines | Contested declarations completed across multiple later turns, temporarily replacing ordinary capture rules. | Structural commitments |
| Chinese Ten family | A hand-card action followed by a stock-card action; usually one complementary target. | Structural two-stage turn |

Rule sources: [Escoba](https://www.pagat.com/fishing/escoba.html), [Basra](https://www.pagat.com/fishing/basra.html), [Pâsur](https://www.pagat.com/fishing/pasur.html), [Cirulla](https://www.pagat.com/fishing/cirulla.html), [Chorizo/Báciga](https://www.pagat.com/fishing/chorizo.html), [Ronda](https://www.pagat.com/fishing/ronda.html), [Cuarenta](https://www.pagat.com/fishing/cuarenta.html), [Porrazo](https://www.pagat.com/fishing/porrazo.html), [Shlla'at](https://www.pagat.com/fishing/shllaat.html), [Ghârat](https://www.pagat.com/fishing/gharat.html), [Pişti](https://www.pagat.com/fishing/pishti.html), [Xeri](https://www.pagat.com/fishing/xeri.html), [Mitaines](https://www.pagat.com/fishing/mitaines.html), [Chinese Ten and variants](https://www.pagat.com/fishing/chinten.html).

Three distinctions should remain explicit in the design: a special capture power is not a numeric value; a face-up stock action is not an ordinary replacement draw; stealing an entire pile, its top set or its top equal-card run are different operations.

## 6. Recommended delivery sequence

1. **Clarify current capability labels and add reusable rule predicates/scoring events.** Preserve the working presets. Implement complementary captures and conditional powers as explicit operators, with a modest first target such as Escoba or Cicera.
2. **Complete one named Seep profile end to end.** Include setup, ownership, house consolidation, scoring and AI behavior. Then add the separately specified 30-point and two-player variants.
3. **Introduce physical card instances and contextual values.** These are shared groundwork for Mulle and fuller joker decks. Add Zwicker's mutable-pile semantics as a separate building policy.
4. **Add multi-card hand actions for Hungarian Kaszinó.** Keep selection and multi-card motion intelligible, and cover variable hand depletion and variant turn rules.
5. **Add ordered piles and turn transactions for African Casino.** Reuse those primitives for Shlla'at and Ghârat without conflating their capture permissions.
6. **Expand declarations, sequence captures and stock phases.** Cirulla/Cirullone, Ronda/Cuarenta and Chinese Ten become subsequent coherent projects. Mitaines and elimination-based games belong later.

This order prioritizes building strategy while allowing smaller, complete additions between the larger changes. The order and implementation sizes are engineering judgments based on the current source.

## 7. Fidelity, sources and completion criteria

**Diloti and Suipi already have playable selected profiles.** Further work should verify their exact restrictions rather than present them as wholly missing families. Suipi sources themselves disagree on some abbreviated dealing instructions; keep the implemented detailed variant identified. [Diloti](https://www.pagat.com/fishing/diloti.html), [PlaySuipi detailed rules](https://playsuipi.com/how-to-play-suipi/), [PlaySuipi moves](https://playsuipi.com/what-moves-can-you-do-in-suipi/), [Cats at Cards Cassino variants](https://www.catsatcards.com/Games/Cassino.html)

The 2008 *Penguin Book of Card Games* was inspected directly. Its **Callabra** account narrows the existing research blocker: small hands, five opening table cards, unused stock and early endings. **Papillon** needs rank-dependent captures, trailing penalties and a sweep that releases the next player's hand to the table; the book explicitly leaves some payments unclear. **Tenteret, Konchinka and Zing** are further historical leads, not implementation-ready priorities. [Parlett, fishing chapter](https://rexresearch1.com/CardGamesLibrary/PenguinBookCardGames.pdf)

**Snitch'ems** and **Laugh and Lie Down** also require named reconstructions. The former has historically uncertain capture interpretations; the latter introduces elimination and out-of-turn claims. [Snitch'ems](https://www.pagat.com/fishing/snitchems.html), [Parlett's Laugh and Lie Down reconstruction](https://www.parlettgames.uk/histocs/laughand.html)

Sources should not be merged silently when they disagree. In particular, final-sweep rules, declared-card obligations, shared-house ownership and joker systems are variant identities. Cats at Cards provides useful corroboration, but its Escopa section contains an impossible card-count threshold; that passage should not drive implementation without another source.

A new preset is ready when its documented setup, legal actions, mandatory rules, scoring, termination, information visibility and AI action generation work together. Verification should include representative rule examples, complete deals, card conservation, save/resume/undo and the new visual interactions. Configuration validation alone does not establish historical fidelity, and a preview should remain blocked until the selected version is complete.
