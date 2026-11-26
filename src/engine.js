/* Fishing Lab — dependency-free, deterministic rules engine.
   This file is shared by the browser and the Node.js test suite. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CassinoEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SUITS = ['S', 'H', 'D', 'C'];
  const DEFAULT_RULES = Object.freeze({
    name: 'Classic Cassino', royal: false, spadeScoring: false,
    sweepPoints: 0, builds: true, multipleBuilds: true,
    allowTrailWithOwnBuild: false, drawMode: false, sweepCancel: false,
    royalAces: false, royalBigLittle: false, pirateCaptures: false,
    pirateBuilds: false, buildAnything: false, winningScore: 21, difficulty: 'thoughtful',
    playerCount: 2, deckSize: 52, deckMode:'legacy', deckCards:null, handSize: 4, initialTableSize: 4,
    customizeCardValues:false, cardValueOverrides:null,
    dealMode: 'batch', remainderMode: 'equal', faceValues: 'standard', aceValue: 1,
    jokerCount: 0, jokerValue: 15, directCapture: true, additiveCapture: true,
    captureGroups: 'unlimited', forcedCapture: 'optional', captureExtent: 'choice',
    additiveBuilds: false, multiHandCapture: false, subtractiveBuilds: false,
    singleCardBuild: false, raiseOwnBuild: true, raiseOpponentBuild: true,
    buildRange: 'all', buildLimit: 'unlimited', mergeSameValue: false, absorbMatching: false,
    tableOnlyBuild: false, pileAccess: 'none', actionsPerTurn: 'single', handCardsPerTurn: 'one', extraAfterSweep: false,
    presetBlocker:'', scoreProfile:'cassino', matchDeals:0, initialTableRule:'any', directPriority:false,
    ignoreOpeningSweep:false, ignoreFinalSweep:false, residueOwner:'lastCapture'
  });
  const PRESETS = Object.freeze({
  "classic": {
    "name": "Classic Cassino"
  },
  "royal": {
    "name": "Royal Cassino",
    "royal": true
  },
  "spade": {
    "name": "Spade Cassino",
    "spadeScoring": true,
    "winningScore": 61
  },
  "royalSpade": {
    "name": "Royal Spade Cassino",
    "royal": true,
    "spadeScoring": true,
    "winningScore": 61
  },
  "draw": {
    "name": "Draw Cassino",
    "dealMode": "draw",
    "drawMode": true
  },
  "wippen": {
    "name": "Wippen",
    "scoreProfile": "wippen"
  },
  "suipi": {
    "name": "Suipi",
    "handSize": 8,
    "initialTableRule": "distinct-nonpoints",
    "forcedCapture": "direct",
    "pirateCaptures": true,
    "buildLimit": "1",
    "sweepPoints": 1,
    "matchDeals": 2
  },
  "dominican": {
    "name": "Dominican Cassino",
    "presetBlocker": "Dominican capture and endgame scoring require implementation."
  },
  "haitian": {
    "name": "Haitian Cassino",
    "presetBlocker": "Exact scoring and final collection rules require verification."
  },
  "diamond": {
    "name": "Diamond Cassino",
    "deckSize": 40,
    "handSize": 3,
    "presetBlocker": "Exact deck and scoring rules require verification."
  },
  "partnership": {
    "name": "Partnership Cassino",
    "playerCount": "4team",
    "presetBlocker": "Four-player partnerships are not implemented."
  },
  "fivePlayer": {
    "name": "Five-player Cassino",
    "presetBlocker": "Five-player gameplay and dealing are not implemented."
  },
  "twentyOne": {
    "name": "Twenty-one Point Cassino",
    "winningScore": 21,
    "presetBlocker": "Mid-deal victory claims are not implemented; ordinary end-of-deal scoring is available in Classic."
  },
  "diloti": {
    "name": "Diloti",
    "handSize": 6,
    "initialTableRule": "no-three-faces",
    "forcedCapture": "faces",
    "raiseOwnBuild": false,
    "pirateCaptures": true,
    "buildLimit": "1",
    "scoreProfile": "diloti",
    "sweepPoints": 10,
    "ignoreOpeningSweep": true,
    "winningScore": 61
  },
  "zwicker": {
    "name": "Zwicker / Zwickern",
    "royal": true,
    "faceValues": "extended",
    "aceValue": 11,
    "subtractiveBuilds": true,
    "singleCardBuild": true,
    "additiveBuilds": true,
    "allowTrailWithOwnBuild": true,
    "presetBlocker": "Variable-valued jokers, fuller arithmetic on builds, special dealing and scoring remain unimplemented."
  },
  "seep": {
    "name": "Seep",
    "royal": true,
    "handSize": 12,
    "dealMode": "full",
    "buildRange": "9-13",
    "raiseOwnBuild": false,
    "mergeSameValue": true,
    "absorbMatching": true,
    "allowTrailWithOwnBuild": true,
    "forcedCapture": "all",
    "captureExtent": "maximal",
    "presetBlocker": "Bidding, shared ownership, partnership gameplay and Seep scoring are not implemented. Preview contains only supported house mechanics."
  },
  "african": {
    "name": "African Casino (Swazi)",
    "royal": true,
    "aceValue": 14,
    "handSize": 12,
    "raiseOwnBuild": false,
    "mergeSameValue": true,
    "pirateCaptures": true,
    "presetBlocker": "Captured-pile stealing, table-only moves, multiple actions and phase restrictions are not implemented."
  },
  "southAfrican": {
    "name": "African Casino (South African)",
    "presetBlocker": "Pip-only 40-card deck, pile access and phase restrictions are not implemented."
  },
  "hungarian": {
    "name": "Hungarian Kaszinó",
    "royal": true,
    "builds": false,
    "multipleBuilds": false,
    "handSize": 3,
    "sweepPoints": 1,
    "extraAfterSweep": true,
    "winningScore": 11,
    "presetBlocker": "Multi-card actions, special redeal order and early victory claims are not implemented."
  },
  "pluck": {
    "name": "Pluck Cassino",
    "presetBlocker": "Pluck actions are not implemented."
  },
  "nordic": {
    "name": "Nordic Kasino",
    "builds": false,
    "multipleBuilds": false,
    "royal": true,
    "presetBlocker": "Card-specific values and regional scoring require implementation."
  },
  "mulle": {
    "name": "Mulle",
    "presetBlocker": "Double deck and identical-card bonuses are not implemented."
  },
  "krypkasino": {
    "name": "Krypkasino",
    "presetBlocker": "Reverse objective and strategy are not implemented."
  },
  "tablic": {
    "name": "Tablić",
    "royal": true,
    "faceValues": "extended",
    "aceValue": 11,
    "builds": false,
    "multipleBuilds": false,
    "handSize": 6,
    "scoreProfile": "tablic",
    "sweepPoints": 1,
    "ignoreFinalSweep": true,
    "residueOwner": "dealer",
    "winningScore": 101
  },
  "tabinet": {
    "name": "Tabinet",
    "royal": true,
    "faceValues": "extended",
    "aceValue": 11,
    "builds": false,
    "multipleBuilds": false,
    "handSize": 6,
    "scoreProfile": "tablic",
    "sweepPoints": 1,
    "ignoreFinalSweep": true,
    "residueOwner": "dealer",
    "winningScore": 101
  },
  "tablanette": {
    "name": "Tablanette",
    "presetBlocker": "Jack sweep and regional scoring are not implemented."
  },
  "elewenjewe": {
    "name": "Eléwénjewé",
    "presetBlocker": "Exact local restrictions and scoring require verification."
  },
  "kontsina": {
    "name": "Kontsina",
    "builds": false,
    "multipleBuilds": false,
    "captureGroups": "one",
    "scoreProfile": "kontsina",
    "winningScore": 21
  },
  "spathi": {
    "name": "Spathi",
    "builds": false,
    "multipleBuilds": false,
    "captureGroups": "one",
    "presetBlocker": "Exact local capture rules and scoring require verification."
  },
  "scopa": {
    "name": "Scopa",
    "deckSize": 40,
    "handSize": 3,
    "royal": true,
    "faceValues": "italian",
    "builds": false,
    "multipleBuilds": false,
    "captureGroups": "one",
    "forcedCapture": "all",
    "directPriority": true,
    "initialTableRule": "no-three-kings",
    "scoreProfile": "scopa",
    "sweepPoints": 1,
    "ignoreFinalSweep": true,
    "winningScore": 11
  },
  "scopone": {
    "name": "Scopone",
    "deckSize": 40,
    "handSize": 3,
    "royal": true,
    "faceValues": "italian",
    "builds": false,
    "multipleBuilds": false,
    "captureGroups": "one",
    "forcedCapture": "all",
    "directPriority": true,
    "initialTableRule": "no-three-kings",
    "scoreProfile": "scopa",
    "sweepPoints": 1,
    "ignoreFinalSweep": true,
    "winningScore": 11,
    "playerCount": "4team",
    "dealMode": "full",
    "presetBlocker": "Four-player partnerships are not implemented."
  },
  "scoponeScientifico": {
    "name": "Scopone Scientifico",
    "deckSize": 40,
    "handSize": 3,
    "royal": true,
    "faceValues": "italian",
    "builds": false,
    "multipleBuilds": false,
    "captureGroups": "one",
    "forcedCapture": "all",
    "directPriority": true,
    "initialTableRule": "no-three-kings",
    "scoreProfile": "scopa",
    "sweepPoints": 1,
    "ignoreFinalSweep": true,
    "winningScore": 11,
    "playerCount": "4team",
    "dealMode": "full",
    "initialTableSize": 0,
    "presetBlocker": "Four-player partnerships are not implemented."
  },
  "chkobba": {
    "name": "Chkobba",
    "deckSize": 40,
    "handSize": 3,
    "royal": true,
    "faceValues": "italian",
    "builds": false,
    "multipleBuilds": false,
    "captureGroups": "one",
    "forcedCapture": "all",
    "directPriority": true,
    "initialTableRule": "no-three-kings",
    "scoreProfile": "scopa",
    "sweepPoints": 1,
    "ignoreFinalSweep": true,
    "winningScore": 11,
    "presetBlocker": "Regional scoring and deal rules need verification."
  },
  "cicera": {
    "name": "Cicera",
    "presetBlocker": "Bonus combinations and endgame rules are not implemented."
  },
  "cirulla": {
    "name": "Cirulla",
    "presetBlocker": "Opening declarations and bonus scoring are not implemented."
  },
  "hurrikan": {
    "name": "Hurrikan",
    "presetBlocker": "Regional rules require verification."
  },
  "escoba": {
    "name": "Escoba",
    "presetBlocker": "Complementary captures and Escoba scoring are not implemented."
  },
  "chorizo": {
    "name": "Chorizo",
    "presetBlocker": "Complementary captures and declarations are not implemented."
  },
  "baciga": {
    "name": "Báciga",
    "presetBlocker": "Complementary captures and combination scoring are not implemented."
  },
  "basra": {
    "name": "Basra",
    "presetBlocker": "Special card sweeps and scoring are not implemented."
  },
  "zandari": {
    "name": "Žandari",
    "presetBlocker": "Special jack captures and scoring are not implemented."
  },
  "pasur": {
    "name": "Pâsur",
    "presetBlocker": "Complementary captures and special jacks are not implemented."
  },
  "ronda": {
    "name": "Ronda",
    "presetBlocker": "Sequence captures and declarations are not implemented."
  },
  "cuarenta": {
    "name": "Cuarenta",
    "presetBlocker": "Sequence captures and immediate bonuses are not implemented."
  },
  "porrazo": {
    "name": "Porrazo",
    "presetBlocker": "Sequence captures and penalties are not implemented."
  },
  "bellaDonna": {
    "name": "Bella Donna",
    "presetBlocker": "Immediate-capture scoring is not implemented."
  },
  "snitchems": {
    "name": "Snitch’ems",
    "presetBlocker": "Special capture totals and scoring are not implemented."
  },
  "casitaRobada": {
    "name": "Casita Robada",
    "presetBlocker": "Whole-pile stealing is not implemented."
  },
  "bellaDonnaHalliel": {
    "name": "Bella Donna Ħalliel",
    "presetBlocker": "Whole-pile stealing is not implemented."
  },
  "shllaat": {
    "name": "Shlla’at",
    "presetBlocker": "Capture-pile access is not implemented."
  },
  "cauRobat": {
    "name": "Cau Robat",
    "presetBlocker": "Whole-pile stealing is not implemented."
  },
  "pisti": {
    "name": "Pişti",
    "presetBlocker": "Stack capture and special scores are not implemented."
  },
  "xeri": {
    "name": "Xeri",
    "presetBlocker": "Stack capture and Xeri scoring are not implemented."
  },
  "mitaines": {
    "name": "Mitaines",
    "presetBlocker": "Stack capture is not implemented."
  },
  "hockey": {
    "name": "Hockey",
    "presetBlocker": "Stack capture is not implemented."
  },
  "money": {
    "name": "Money",
    "presetBlocker": "Stack capture is not implemented."
  },
  "gharat": {
    "name": "Ghârat",
    "presetBlocker": "Stack capture and pile stealing are not implemented."
  },
  "laugh": {
    "name": "Laugh and Lie Down",
    "presetBlocker": "Set capture and elimination are not implemented."
  },
  "chineseTen": {
    "name": "Chinese Ten",
    "presetBlocker": "Extra stock actions and complementary captures are not implemented."
  },
  "redFrog": {
    "name": "Red Frog Black Frog",
    "presetBlocker": "Extra stock actions and local scoring are not implemented."
  },
  "mainMerah": {
    "name": "Main Merah",
    "presetBlocker": "Extra stock actions and local scoring are not implemented."
  },
  "california": {
    "name": "California Cassino",
    "presetBlocker": "Exact historical rules require further research."
  },
  "skwitz": {
    "name": "Skwitz",
    "presetBlocker": "Exact historical rules require further research."
  },
  "callabra": {
    "name": "Callabra",
    "presetBlocker": "Exact historical rules require further research."
  },
  "papillon": {
    "name": "Papillon",
    "presetBlocker": "Exact historical rules require further research."
  },
  "tuxedo": {
    "name": "Tuxedo",
    "presetBlocker": "Special Rook deck and exact rules are not implemented."
  }
});
  const PRESET_CATALOG = Object.freeze([
  {
    "id": "classic",
    "name": "Classic Cassino",
    "group": "Cassino",
    "note": "Standard two-player Cassino.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "royal",
    "name": "Royal Cassino",
    "group": "Cassino",
    "note": "Numerical face cards.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "spade",
    "name": "Spade Cassino",
    "group": "Cassino",
    "note": "Each spade scores.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "royalSpade",
    "name": "Royal Spade Cassino",
    "group": "Cassino",
    "note": "Royal values and spade scoring.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "draw",
    "name": "Draw Cassino",
    "group": "Small variations",
    "note": "Draw a replacement after every play.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "wippen",
    "name": "Wippen",
    "group": "Small variations",
    "note": "Belgian scoring: two points for each majority.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "suipi",
    "name": "Suipi",
    "group": "Small variations",
    "note": "Eight-card hands, restricted starting table, compulsory direct matches and a two-deal match. Samoan house rules vary.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "dominican",
    "name": "Dominican Cassino",
    "group": "Small variations",
    "note": "Regional capture and scoring.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "haitian",
    "name": "Haitian Cassino",
    "group": "Small variations",
    "note": "Regional scoring and collection.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "diamond",
    "name": "Diamond Cassino",
    "group": "Small variations",
    "note": "Reduced deck and short hands.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "partnership",
    "name": "Partnership Cassino",
    "group": "Small variations",
    "note": "Two partnerships of two players.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "fivePlayer",
    "name": "Five-player Cassino",
    "group": "Small variations",
    "note": "Five individual players.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "twentyOne",
    "name": "Twenty-one Point Cassino",
    "group": "Small variations",
    "note": "21-point target and optional early victory claim.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "diloti",
    "name": "Diloti",
    "group": "Major variations",
    "note": "Two-player Greek declarations, six-card hands and 10-point sweeps.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "zwicker",
    "name": "Zwicker / Zwickern",
    "group": "Major variations",
    "note": "Subtractive arithmetic and mutable builds.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "seep",
    "name": "Seep",
    "group": "Major variations",
    "note": "Houses worth 9–13 and compulsory captures.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "african",
    "name": "African Casino (Swazi)",
    "group": "Major variations",
    "note": "Reuse opponents’ captured cards in builds.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "southAfrican",
    "name": "African Casino (South African)",
    "group": "Major variations",
    "note": "Capture from exposed winnings.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "hungarian",
    "name": "Hungarian Kaszinó",
    "group": "Major variations",
    "note": "Play several cards from hand in one capture.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "pluck",
    "name": "Pluck Cassino",
    "group": "Major variations",
    "note": "Special table-card removals.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "nordic",
    "name": "Nordic Kasino",
    "group": "Major variations",
    "note": "Special capture values; usually no building.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "mulle",
    "name": "Mulle",
    "group": "Major variations",
    "note": "Double-deck fishing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "krypkasino",
    "name": "Krypkasino",
    "group": "Major variations",
    "note": "Avoid capturing points.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "tablic",
    "name": "Tablić",
    "group": "Major variations",
    "note": "Serbian end-of-deal version; ceremonial cut and exposed bottom card omitted.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "tabinet",
    "name": "Tabinet",
    "group": "Major variations",
    "note": "Romanian end-of-deal version; optional hand rejection and ceremonial cut omitted.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "tablanette",
    "name": "Tablanette",
    "group": "Major variations",
    "note": "Special jack clears.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "elewenjewe",
    "name": "Eléwénjewé",
    "group": "Major variations",
    "note": "Restricted capture combinations.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "kontsina",
    "name": "Kontsina",
    "group": "Major variations",
    "note": "Greek single-group fishing, cumulative-score variant.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "spathi",
    "name": "Spathi",
    "group": "Major variations",
    "note": "Albanian relative of Kontsina.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "scopa",
    "name": "Scopa",
    "group": "Major variations",
    "note": "Two-player French-suited Scopa with matching priority and primiera scoring.",
    "status": "playable",
    "partial": false
  },
  {
    "id": "scopone",
    "name": "Scopone",
    "group": "Major variations",
    "note": "Nine-card partnership Scopa.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "scoponeScientifico",
    "name": "Scopone Scientifico",
    "group": "Major variations",
    "note": "All cards dealt to two partnerships.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "chkobba",
    "name": "Chkobba",
    "group": "Major variations",
    "note": "North African Scopa family.",
    "status": "preview",
    "partial": true
  },
  {
    "id": "cicera",
    "name": "Cicera",
    "group": "Major variations",
    "note": "Additional scoring combinations.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "cirulla",
    "name": "Cirulla",
    "group": "Major variations",
    "note": "Declarations and capture variants.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "hurrikan",
    "name": "Hurrikan",
    "group": "Major variations",
    "note": "German Scopa relative.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "escoba",
    "name": "Escoba",
    "group": "Major variations",
    "note": "Capture by making 15.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "chorizo",
    "name": "Chorizo",
    "group": "Major variations",
    "note": "Escoba with declarations.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "baciga",
    "name": "Báciga",
    "group": "Major variations",
    "note": "Escoba with extra combination scoring.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "basra",
    "name": "Basra",
    "group": "Major variations",
    "note": "Special sweeping cards.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "zandari",
    "name": "Žandari",
    "group": "Major variations",
    "note": "Jack sweeps.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "pasur",
    "name": "Pâsur",
    "group": "Major variations",
    "note": "Make 11 and special jacks.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "ronda",
    "name": "Ronda",
    "group": "Major variations",
    "note": "Consecutive sequence captures.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "cuarenta",
    "name": "Cuarenta",
    "group": "Major variations",
    "note": "Sequences and bonuses.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "porrazo",
    "name": "Porrazo",
    "group": "Major variations",
    "note": "Sequences and penalties.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "bellaDonna",
    "name": "Bella Donna",
    "group": "Major variations",
    "note": "Immediate capture bonuses.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "snitchems",
    "name": "Snitch’ems",
    "group": "Major variations",
    "note": "Special capture totals.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "casitaRobada",
    "name": "Casita Robada",
    "group": "Other fishing games",
    "note": "Steal entire capture piles.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "bellaDonnaHalliel",
    "name": "Bella Donna Ħalliel",
    "group": "Other fishing games",
    "note": "Match opponents’ capture-pile top card.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "shllaat",
    "name": "Shlla’at",
    "group": "Other fishing games",
    "note": "Capturing opponents’ winnings.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "cauRobat",
    "name": "Cau Robat",
    "group": "Other fishing games",
    "note": "Simplified pile stealing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "pisti",
    "name": "Pişti",
    "group": "Other fishing games",
    "note": "Central stack fishing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "xeri",
    "name": "Xeri",
    "group": "Other fishing games",
    "note": "Central stack fishing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "mitaines",
    "name": "Mitaines",
    "group": "Other fishing games",
    "note": "Central stack fishing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "hockey",
    "name": "Hockey",
    "group": "Other fishing games",
    "note": "Canadian stack fishing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "money",
    "name": "Money",
    "group": "Other fishing games",
    "note": "Simple stack fishing.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "gharat",
    "name": "Ghârat",
    "group": "Other fishing games",
    "note": "Capture play and winnings piles.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "laugh",
    "name": "Laugh and Lie Down",
    "group": "Other fishing games",
    "note": "Matching sets and dropping out.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "chineseTen",
    "name": "Chinese Ten",
    "group": "Other fishing games",
    "note": "Extra stock card each turn.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "redFrog",
    "name": "Red Frog Black Frog",
    "group": "Other fishing games",
    "note": "Chinese Ten relative.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "mainMerah",
    "name": "Main Merah",
    "group": "Other fishing games",
    "note": "Indonesian Chinese Ten relative.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "california",
    "name": "California Cassino",
    "group": "Historical research",
    "note": "Peripheral or historical fishing-game research.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "skwitz",
    "name": "Skwitz",
    "group": "Historical research",
    "note": "Peripheral or historical fishing-game research.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "callabra",
    "name": "Callabra",
    "group": "Historical research",
    "note": "Peripheral or historical fishing-game research.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "papillon",
    "name": "Papillon",
    "group": "Historical research",
    "note": "Peripheral or historical fishing-game research.",
    "status": "preview",
    "partial": false
  },
  {
    "id": "tuxedo",
    "name": "Tuxedo",
    "group": "Historical research",
    "note": "Peripheral or historical fishing-game research.",
    "status": "preview",
    "partial": false
  }
]);
  const DIFFICULTY_INFO = Object.freeze([
  [
    "casual",
    "Easy",
    "Chooses randomly from legal moves, favoring captures about 78% of the time when captures exist. Does not plan ahead."
  ],
  [
    "thoughtful",
    "Medium",
    "Scores available moves by immediate capture size, valuable cards, builds and sweeps; usually chooses the highest-scoring move, with slight randomness. No opponent lookahead."
  ],
  [
    "hard",
    "Hard",
    "Samples plausible hidden hands from public card information and searches possible opponent responses, normally up to two plies. Uses a limited search budget."
  ],
  [
    "expert",
    "Expert",
    "Samples more possible hidden hands and searches several turns ahead, normally up to four plies. Can solve small, fully inferable endgames when the search budget allows."
  ]
]);

  function rulesFor(preset = 'classic', overrides = {}) {
    const profile=PRESETS[preset]||PRESETS.classic;
    return normalizeRules({...DEFAULT_RULES,...profile,...overrides,dealMode:overrides.dealMode??(Object.hasOwn(overrides,'drawMode')?(overrides.drawMode?'draw':'batch'):(profile.dealMode??(profile.drawMode?'draw':'batch')))});
  }
  function normalizeRules(input={}) {
    const r={...DEFAULT_RULES,...input};
    // Old saves use drawMode and royalAces; retain those flags as aliases.
    if(!Object.hasOwn(input,'dealMode')) r.dealMode=r.drawMode?'draw':'batch';
    if(r.dealMode==='batch'&&r.drawMode) r.dealMode='draw';
    r.drawMode=r.dealMode==='draw';
    // Preserve the composition of existing Italian 40-card presets and saves.
    // New deckMode='40' means A–10, not the old Italian pack.
    if(r.deckMode==='legacy'||r.deckMode==null){
      if(r.deckSize===40&&[0,1,2].includes(r.jokerCount)){
        r.deckMode='custom';
        r.deckCards=allCards().filter(c=>c.suit==='X'?Number(c.id.slice(1))<=r.jokerCount:c.rank<8||c.rank>10).map(c=>c.id);
      }else if((r.deckSize===52||r.deckSize===54)&&[0,1,2].includes(r.jokerCount)){
        if(r.deckSize===54||r.jokerCount===2)r.deckMode='54';
        else if(r.jokerCount===1){r.deckMode='custom';r.deckCards=allCards().filter(c=>c.id!=='X2').map(c=>c.id);}
        else r.deckMode='52';
      }
    }
    if(['40','52','54','custom'].includes(r.deckMode)){
      const deck=makeDeck(r);
      r.deckSize=deck.length;r.jokerCount=deck.filter(c=>c.suit==='X').length;
    }
    if(r.customizeCardValues&&r.cardValueOverrides==null)r.cardValueOverrides=initialCardValues(r);
    return r;
  }
  function availableValues(rules) {
    return [...new Set(makeDeck(rules).flatMap(c=>cardValues(c,rules)))].sort((a,b)=>a-b);
  }
  function buildTargets(rules) {
    const values=availableValues(rules);
    return rules.buildRange==='9-13'?values.filter(v=>v>=9&&v<=13):
      rules.buildRange==='10-13'?values.filter(v=>v>=10&&v<=13):values;
  }
  function validateRules(input={}) {
    const r=normalizeRules(input),errors=[],warnings=[],unavailable=[];
    const allowed={playerCount:[2,4,'4team'],deckMode:['40','52','54','custom'],initialTableSize:[0,3,4,8],
      dealMode:['batch','draw','full','bid'],remainderMode:['equal','uneven','strict'],
      faceValues:['standard','extended','italian'],aceValue:[1,11,14],jokerCount:[0,1,2],jokerValue:Array.from({length:30},(_,i)=>i+1),
      captureGroups:['one','unlimited'],forcedCapture:['optional','faces','direct','all'],captureExtent:['choice','maximal','maximum'],
      buildRange:['all','9-13','10-13'],buildLimit:['1','2','unlimited'],pileAccess:['none','build','capture','both'],
      actionsPerTurn:['single','multiple'],handCardsPerTurn:['one','multiple'],scoreProfile:['cassino','wippen','diloti','kontsina','tablic','scopa'],matchDeals:[0,1,2,3,4,6],initialTableRule:['any','distinct-nonpoints','no-three-faces','no-three-kings'],residueOwner:['lastCapture','dealer']};
    for(const [k,options] of Object.entries(allowed))if(!options.includes(r[k]))errors.push('Invalid setting: '+k+'.');
    for(const [k,v] of Object.entries(DEFAULT_RULES))if(typeof v==='boolean'&&typeof r[k]!=='boolean')errors.push('Invalid switch: '+k+'.');
    if(!Number.isInteger(r.winningScore)||r.winningScore<1||!Number.isInteger(r.sweepPoints)||r.sweepPoints<0)errors.push('Score settings must be nonnegative whole numbers, with a positive winning score.');
    const deck=makeDeck(r),players=r.playerCount===2?2:4,count=deck.length-r.initialTableSize;
    const maxHand=Math.floor(deck.length/players);
    if(r.deckMode==='custom'){
      const valid=new Set(allCards().map(c=>c.id));
      if(!Array.isArray(r.deckCards)||r.deckCards.some(id=>!valid.has(id))||new Set(r.deckCards).size!==r.deckCards.length)errors.push('Custom deck contains invalid or duplicate card IDs.');
    }
    if(r.customizeCardValues){
      const keys=new Set(allCards().filter(c=>c.suit!=='X').map(c=>c.id).concat('Joker'));
      const values=r.cardValueOverrides;
      if(!values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([key,v])=>!keys.has(key)||!Array.isArray(v)||v.length>2||new Set(v).size!==v.length||v.some(n=>!Number.isInteger(n)||n<1||n>30)))errors.push('Custom card values must be one or two distinct integers from 1–30, or rank matching only.');
    }
    if(deck.length<players||count<players)errors.push('The deck must leave at least one hand card per player after the starting table.');
    if(!Number.isInteger(r.handSize)||r.handSize<1||(r.dealMode!=='full'&&r.handSize>maxHand))errors.push('Cards per hand must be between 1 and '+maxHand+' for this deck.');
    if(r.dealMode!=='full'&&count<players*r.handSize)errors.push('Not enough cards for all starting hands after placing the starting table.');
    if(r.dealMode==='batch'&&r.remainderMode==='strict'&&count%(players*r.handSize)!==0)errors.push('The stock cannot be exhausted in complete batches.');
    if(r.dealMode!=='draw'&&r.remainderMode!=='uneven'&&count%players!==0)errors.push('The remaining deck cannot be divided equally. Allow unequal hands or change table size.');
    if(!r.directCapture&&!r.additiveCapture)errors.push('Enable at least one table-card capture method.');
    if(r.multiHandCapture&&r.handCardsPerTurn==='one')errors.push('Multi-card captures require spending more than one hand card per turn.');
    if(r.builds&&r.tableOnlyBuild&&r.actionsPerTurn==='single')errors.push('Table-only building requires multiple actions per turn.');
    if(r.builds&&(r.mergeSameValue||r.absorbMatching)&&!r.multipleBuilds)errors.push('Mandatory merging and absorption require multiple builds.');
    if(r.builds&&r.buildRange!=='all'){
      const targets=buildTargets(r), min=r.buildRange==='9-13'?9:10;
      if(!targets.length)errors.push('No cards can capture a build in the selected range.');
      else if(targets.length<14-min)warnings.push('Only these build values are available: '+targets.join(', ')+'.');
    }
    if(!r.builds&&(r.tableOnlyBuild||r.subtractiveBuilds||r.additiveBuilds||r.mergeSameValue||r.absorbMatching))warnings.push('Build-specific rules are inactive while building is off.');
    if(r.builds&&r.buildAnything)warnings.push('Unbacked builds are experimental; a stranded build may be collected at hand end.');
    if(r.forcedCapture==='direct'&&!r.directCapture)warnings.push('Compulsory direct matching has no effect on table cards when direct matching is off.');
    if(r.forcedCapture!=='optional'&&r.builds&&!r.buildAnything)warnings.push('Build obligations take precedence; only otherwise legal captures can be compulsory.');
    if(r.presetBlocker)unavailable.push(String(r.presetBlocker));
    if(!r.customizeCardValues&&r.royal&&r.faceValues==='italian'&&deck.some(c=>c.suit!=='X'&&c.rank>=8&&c.rank<=10)&&deck.some(c=>c.suit!=='X'&&c.rank>=11))errors.push('Italian face values require removing 8–10 when face cards are included; use a custom deck.');
    if(r.initialTableSize>openingCapacity(deck,r.initialTableRule))errors.push('The selected deck cannot satisfy the starting table restrictions.');
    if(r.builds&&!availableValues(r).length)warnings.push('There are no numerical card values; building is unavailable in this deck.');
    if(!r.directCapture&&!availableValues(r).length)errors.push('Rank-only cards cannot make additive captures when direct matching is off.');
    if(r.playerCount!==2)unavailable.push('Three- and four-player gameplay is not implemented.');
    if(r.dealMode==='bid')unavailable.push('Opening bidding is not implemented.');
    if(r.multiHandCapture||r.handCardsPerTurn==='multiple')unavailable.push('Multi-card hand actions are not implemented.');
    if(r.actionsPerTurn==='multiple'||(r.builds&&r.tableOnlyBuild))unavailable.push('Multi-action turns and table-only building are not implemented.');
    if(r.pileAccess==='capture'||r.pileAccess==='both'||(r.builds&&r.pileAccess==='build'))unavailable.push('Stealing from captured piles is not implemented.');
    return {rules:r,errors,warnings,unavailable,playable:!errors.length&&!unavailable.length};
  }
  function allCards(){
    return SUITS.flatMap(suit=>Array.from({length:13},(_,i)=>({id:suit+(i+1),suit,rank:i+1})))
      .concat([{id:'X1',suit:'X',rank:14},{id:'X2',suit:'X',rank:14}]);
  }
  function cardKey(card){return card.suit==='X'?'Joker':card.id;}
  function cardName(card) {
    if(card.suit==='X')return 'Joker';
    return String(({1:'A',11:'J',12:'Q',13:'K'})[card.rank]||card.rank)+({S:'♠',H:'♥',D:'♦',C:'♣'})[card.suit];
  }
  function standardCardValues(card,rules){
    if(card.suit==='X')return [Number(rules.jokerValue)||15];
    const base=card.rank<=10?card.rank:rules.royal?card.rank+(rules.faceValues==='extended'?1:rules.faceValues==='italian'?-3:0):null;
    if(base===null)return [];
    const values=[base];
    if(card.rank===1&&(rules.royalAces||Number(rules.aceValue)>1))values.push(rules.royalAces?14:Number(rules.aceValue));
    if(rules.royalBigLittle&&card.id==='S2')values.push(15);
    if(rules.royalBigLittle&&card.id==='D10')values.push(16);
    return values;
  }
  function initialCardValues(rules){
    const result={};
    for(const c of allCards())result[cardKey(c)]=standardCardValues(c,rules);
    return result;
  }
  function cardValues(card,rules){
    const key=cardKey(card),map=rules.cardValueOverrides;
    if(rules.customizeCardValues&&map&&Object.hasOwn(map,key)){
      const vals=map[key];
      return Array.isArray(vals)?vals.filter(v=>Number.isInteger(v)&&v>=1&&v<=30):[];
    }
    return standardCardValues(card,rules);
  }
  function cardValue(card,rules){return cardValues(card,rules)[0]??null;}
  function maxBuildValue(rules){
    if(!rules.customizeCardValues&&(rules.deckMode==='52'||rules.deckMode===undefined&&rules.deckSize!==40)&&!rules.jokerCount)
      return Math.max(rules.royalBigLittle?16:0,rules.royalAces?14:Number(rules.aceValue)||1,rules.royal?(rules.faceValues==='extended'?14:rules.faceValues==='italian'?10:13):10);
    return Math.max(0,...availableValues(rules));
  }
  function rankMatch(a,b,rules){
    return a.rank===b.rank&&!cardValues(a,rules).length&&!cardValues(b,rules).length;
  }
  function openingCapacity(deck,rule){
    if(rule==='distinct-nonpoints')return new Set(deck.filter(c=>c.rank!==1&&c.id!=='D10'&&c.id!=='S2').map(c=>c.rank)).size;
    if(rule==='no-three-faces'||rule==='no-three-kings'){
      const counts=new Map();for(const c of deck)counts.set(c.rank,(counts.get(c.rank)||0)+1);
      return [...counts].reduce((n,[rank,count])=>n+((rule==='no-three-faces'&&rank>=11&&rank<=13||rule==='no-three-kings'&&rank===13)?Math.min(2,count):count),0);
    }
    return deck.length;
  }
  function hasValue(hand, value, rules) {
    return hand.some(c => cardValues(c, rules).includes(value));
  }
  function findValuePartition(cards, target, desired, rules) {
    if (!cards.length || !Number.isInteger(target) || target < 1) return null;
    const possible = cards.map(x => cardValues(x.card, rules).filter(v => v <= target));
    if (possible.some(vals => !vals.length)) return null;
    // The common case has exactly one value for every card. No recursive
    // assignment or array copies are necessary before partitioning.
    if (possible.every(vals => vals.length === 1)) {
      return findPartition(cards.map((x,i) => ({card:x.card,v:possible[i][0]})), target, desired);
    }
    // For alternate values, prune branches whose remaining values cannot
    // make a total divisible by the target. Original value order is retained.
    const residues=Array(cards.length+1);
    residues[cards.length]=new Set([0]);
    for(let i=cards.length-1;i>=0;i--){
      const next=new Set();
      for(const value of possible[i])for(const rest of residues[i+1])next.add((value+rest)%target);
      residues[i]=next;
    }
    const chosen=[];
    const choose = (i,total) => {
      if(!residues[i].has((target-total%target)%target))return null;
      if (i === cards.length) return findPartition(chosen, target, desired);
      for (const v of possible[i]) {
        if(desired==='single'&&total+v>target)continue;
        chosen.push({card:cards[i].card,v});
        const result=choose(i+1,total+v);
        chosen.pop();
        if(result)return result;
      }
      return null;
    };
    return choose(0,0);
  }
  function makeDeck(rules=DEFAULT_RULES){
    const mode=rules.deckMode,cards=allCards();
    if(mode==='40')return cards.filter(c=>c.suit!=='X'&&c.rank<=10);
    if(mode==='52')return cards.filter(c=>c.suit!=='X');
    if(mode==='54')return cards;
    if(mode==='custom'){const ids=new Set(Array.isArray(rules.deckCards)?rules.deckCards:[]);return cards.filter(c=>ids.has(c.id));}
    // Compatibility for callers using the old deckSize/jokerCount API.
    return cards.filter(c=>c.suit==='X'?Number(c.id.slice(1))<=(rules.jokerCount||0):rules.deckSize!==40||c.rank<8||c.rank>10);
  }
  function shuffle(array, random = Math.random) {
    const deck = [...array];
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }
  function makeState(rules = rulesFor(), dealer = 1, scores = [0, 0], round = 1, random = Math.random) {
    rules=normalizeRules(rules);
    const validation=validateRules(rules);
    if(!validation.playable)throw new Error([...validation.errors,...validation.unavailable].join(' '));
    const state = {
      rules: { ...rules }, players: [
        { name: 'You', hand: [], captured: [], sweeps: 0, score: scores[0] },
        { name: 'Computer', hand: [], captured: [], sweeps: 0, score: scores[1] }
      ], table: [], stock: shuffle(makeDeck(rules), random),
      dealer, turn: 1 - dealer, lastCapture: null, nextId: 1, extraTurnFor: null, lastActor: null, unclaimed: [],
      round, phase: 'playing', result: null, lastAction: 'New hand dealt.',
      log: [], moveNumber: 0
    };
    drawCards(state, true);
    return state;
  }
  function newMatch(rules = rulesFor(), random = Math.random) {
    return makeState(rules, 1, [0, 0], 1, random);
  }
  function drawCards(state, initial = false) {
    if (initial) {
      const rule=state.rules.initialTableRule||'any',deferred=[];
      for(let i=0;i<(state.rules.initialTableSize??4);i++){
        let card;
        while(state.stock.length){
          const c=state.stock.pop(),same=state.table.filter(e=>e.card.rank===c.rank).length;
          const bad=rule==='distinct-nonpoints'?(same>0||c.rank===1||c.id==='D10'||c.id==='S2'):
            rule==='no-three-faces'?(c.rank>=11&&c.rank<=13&&same>=2):rule==='no-three-kings'?(c.rank===13&&same>=2):false;
          if(bad){deferred.push(c);continue;}card=c;break;
        }
        if(!card)throw Error('Unable to deal a legal starting table.');
        state.table.push({id:`t${state.nextId++}`,type:'loose',card});
      }
      state.stock.unshift(...deferred);
    }
    const count=state.rules.dealMode==='full'?state.stock.length:Math.min(state.stock.length,2*(state.rules.handSize||4));
    // Alternate from the nondealer, including a legal smaller/unequal final batch.
    for(let i=0;i<count;i++)state.players[i%2].hand.push(state.stock.pop());
  }
  function cardsInElement(element) {
    return element.type === 'loose' ? [element.card] : element.groups.flat();
  }
  function findPartition(cards, target, desired = 'any') {
    if (!cards.length || !Number.isInteger(target) || target < 1) return null;
    const values = cards.map(c => c.v);
    if (values.some(v => !Number.isInteger(v) || v < 1 || v > target)) return null;
    const total=values.reduce((sum,v)=>sum+v,0);
    if(total%target || (desired==='single'&&total!==target) ||
      (desired==='multiple'&&total<2*target))return null;
    // The unique single-group partition is always in original card order.
    if(total===target)return [cards.map(x=>x.card)];
    const failed=new Set();
    // First unchecked card always starts the next group, so each partition is found once.
    const walk = (remaining, groups) => {
      if (!remaining.length) {
        if (desired === 'single' && groups.length !== 1) return null;
        if (desired === 'multiple' && groups.length < 2) return null;
        return groups;
      }
      // Only impossible subproblems are memoized. A successful branch
      // still returns the original card identities in the original order.
      const key=remaining.map(x=>x.v).join(',');
      if(failed.has(key))return null;
      const [first, ...rest] = remaining;
      const choose = (offset, need, selected, leftovers) => {
        if (need === 0) {
          const result = walk(leftovers.concat(rest.slice(offset)), [...groups, [first, ...selected]]);
          if (result) return result;
          return null;
        }
        for (let i = offset; i < rest.length; i++) {
          if (rest[i].v > need) continue;
          const skipped = leftovers.concat(rest.slice(offset, i));
          const result = choose(i + 1, need - rest[i].v, [...selected, rest[i]], skipped);
          if (result) return result;
        }
        return null;
      };
      const result=choose(0, target - first.v, [], []);
      if(!result&&failed.size<4096)failed.add(key);
      return result;
    };
    const partition = walk(cards.map((card, i) => ({ ...card, v: values[i] })), []);
    return partition && partition.map(group => group.map(x => x.card));
  }
  function ownBuildObligation(state, table, hand, player) {
    if (state.rules.buildAnything) return null;
    // A multiple build occupies one table element, regardless of its number
    // of equal-valued groups. Each independent owned element needs a distinct
    // physical card in the remaining hand, even if the values are identical.
    const own = table.filter(element => element.type === 'build' && element.owner === player);
    const values = hand.map(card => cardValues(card, state.rules));
    const obligations = own.map(element => ({
      value: element.value,
      choices: values.flatMap((possible, index) => possible.includes(element.value) ? [index] : [])
    })).sort((a,b) => a.choices.length - b.choices.length);
    for (const obligation of obligations) {
      if (!obligation.choices.length) return `You must retain a ${obligation.value} to capture your existing build.`;
    }
    // Solve the small assignment problem, rather than counting ranks
    // independently. A Royal Ace, for example, cannot reserve both a 1
    // and a 14 build, but can reserve either if a different card covers the
    // other. Backtracking avoids rejecting valid overlapping value choices.
    const used = new Set();
    function reserve(index) {
      if (index === obligations.length) return true;
      for (const choice of obligations[index].choices) {
        if (used.has(choice)) continue;
        used.add(choice);
        if (reserve(index + 1)) return true;
        used.delete(choice);
      }
      return false;
    }
    if (own.length > hand.length || !reserve(0)) {
      return 'Each independent build needs its own matching capture card in your hand.';
    }
    return null;
  }
  function describeCapture(selection, card, rules) {
    if (!selection.length) return { ok:false, reason:'Select at least one table card to capture.' };
    if(rules.directCapture===false||rules.additiveCapture===false||rules.captureGroups==='one'||rules.additiveBuilds){
      return describeCustomCapture(selection,card,rules);
    }
    const playedValues = cardValues(card, rules);
    if (!playedValues.length) {
      if (selection.length !== 1 || selection[0].type !== 'loose' || !rankMatch(selection[0].card,card,rules)) {
        return { ok:false, reason:'A non-numerical face card or rank-only card captures one equal-rank card that is also rank-only.' };
      }
      return {ok:true};
    }
    const loose = selection.filter(e => e.type === 'loose').map(e => ({card:e.card}));
    const builds = selection.filter(e => e.type === 'build');
    for (const value of playedValues) {
      if (builds.some(e => e.value !== value)) continue;
      if (loose.length && !findValuePartition(loose, value, 'any', rules)) continue;
      if (builds.length || loose.length) return {ok:true, value};
    }
    return {ok:false, reason:'Selected cards must form matching groups at one legal value (builds must match exactly).'};
  }
  function describeCustomCapture(selection,card,rules){
    const direct=rules.directCapture!==false,sum=rules.additiveCapture!==false;
    const played=cardValues(card,rules);
    if(!played.length)return direct&&selection.length===1&&selection[0].type==='loose'&&rankMatch(selection[0].card,card,rules)
      ?{ok:true}:{ok:false,reason:'Non-numerical face cards require a direct rank match.'};
    for(const target of played){
      const fixed=selection.filter(e=>e.type==='build'&&(!rules.additiveBuilds||e.groups.length!==1));
      if(fixed.some(e=>e.value!==target))continue;
      const entries=selection.filter(e=>!fixed.includes(e));
      const choices=entries.map(e=>{
        const vals=e.type==='build'?[e.value]:cardValues(e.card,rules);
        return vals.filter(v=>v<=target&&(e.type==='build'||direct||v!==target)&&(sum||v===target));
      });
      if(choices.some(x=>!x.length))continue;
      const chosen=[];
      function walk(i,total){
        if(i===entries.length){
          if(!chosen.length)return fixed.length>0&&(rules.captureGroups!=='one'||fixed.length===1);
          const groups=findPartition(chosen,target,rules.captureGroups==='one'?'single':'any');
          return !!groups&&(rules.captureGroups!=='one'||groups.length+fixed.length===1);
        }
        for(const v of choices[i]){
          if(rules.captureGroups==='one'&&total+v>target)continue;
          chosen.push({card:entries[i],v});const ok=walk(i+1,total+v);chosen.pop();if(ok)return true;
        }
        return false;
      }
      if(walk(0,0))return {ok:true,value:target};
    }
    return {ok:false,reason:'The selected cards do not satisfy the enabled capture methods or group limit.'};
  }
  function* rawCaptureMoves(state,card){
    const vals=cardValues(card,state.rules);
    if(!vals.length){
      for(const item of state.table)if(item.type==='loose'&&rankMatch(item.card,card,state.rules))yield {kind:'capture',cardId:card.id,targetIds:[item.id]};
      return;
    }
    const seen=new Set();
    for(const target of vals){
      const entries=state.table.map(x=>({id:x.id,values:x.type==='build'?
        (x.value===target||state.rules.additiveBuilds&&x.groups.length===1&&x.value<target?[x.value]:[]):cardValues(x.card,state.rules).filter(v=>v<=target)})).filter(x=>x.values.length);
      for(const ids of hintSubsets(entries,target,[0],false)){
        const key=ids.slice().sort().join(',');if(seen.has(key))continue;seen.add(key);
        yield {kind:'capture',cardId:card.id,targetIds:ids};
      }
    }
  }
  function capturePolicy(state,action,card,selected){
    const rules=state.rules;
    if(action.kind==='trail'&&rules.forcedCapture&&rules.forcedCapture!=='optional'&&(rules.forcedCapture!=='faces'||card.rank>=11&&card.rank<=13)){
      for(const move of rawCaptureMoves(state,card)){
        if(rules.forcedCapture==='direct'&&(move.targetIds.length!==1||!state.table.some(e=>e.id===move.targetIds[0]&&e.type==='loose')))continue;
        if(validateAction(state,move,true).ok)return 'This card has a compulsory legal capture.';
      }
    }
    if(action.kind==='capture'&&rules.captureExtent&&rules.captureExtent!=='choice'){
      const ids=new Set(action.targetIds),size=selected.reduce((n,e)=>n+cardsInElement(e).length,0);
      for(const move of rawCaptureMoves(state,card)){
        if(rules.captureExtent==='maximal'&&!(move.targetIds.length>ids.size&&[...ids].every(id=>move.targetIds.includes(id))))continue;
        const candidateSize=state.table.filter(e=>move.targetIds.includes(e.id)).reduce((n,e)=>n+cardsInElement(e).length,0);
        if(rules.captureExtent==='maximum'&&candidateSize<=size)continue;
        if(validateAction(state,move,true).ok)return rules.captureExtent==='maximal'?'Include the remaining eligible capture group.':'Choose a legal capture taking the most cards.';
      }
    }
    return null;
  }
  function describeBuild(selection, card, remainingHand, rules, requestedValue, requestedMode) {
    if (!rules.builds) return { ok:false, reason:'Building is disabled.' };
    const playedValues = cardValues(card, rules);
    if (!playedValues.length) return {ok:false,reason:'This card has no numerical build value.'};
    if (!Number.isInteger(requestedValue) || requestedValue < 1 || requestedValue > maxBuildValue(rules)) {
      return {ok:false, reason:'Choose a valid build value.'};
    }
    if(rules.buildRange&&rules.buildRange!=='all'&&!buildTargets(rules).includes(requestedValue))return {ok:false,reason:'That build value is outside the permitted range.'};
    if (!rules.buildAnything && !hasValue(remainingHand, requestedValue, rules)) {
      return {ok:false,reason:`Keep a ${requestedValue} in hand to capture your build (or turn Build Obligation off).`};
    }
    const builds = selection.filter(e => e.type === 'build');
    const loose = selection.filter(e => e.type === 'loose').map(e => ({card:e.card}));
    if (loose.some(x => !cardValues(x.card, rules).length)) {
      return {ok:false,reason:'Face cards need numerical Royal values to form builds.'};
    }
    if (builds.length > 1) {
      // One contributed hand card must raise exactly one single build.
      // Other selected builds may join only at their unchanged value.
      if(requestedMode!=='merge'||!rules.multipleBuilds)
        return {ok:false,reason:'A raise-and-merge requires Multiple Builds.'};
      const lower=builds.filter(b=>b.value!==requestedValue);
      const matching=builds.filter(b=>b.value===requestedValue);
      if(!lower.length&&rules.mergeSameValue){
        const extra=findValuePartition([{card},...loose],requestedValue,'any',rules);
        if(extra)return {ok:true,build:{value:requestedValue,groups:matching.flatMap(b=>b.groups).concat(extra),kind:'multiple',operation:'merge'}};
      }
      if(lower.length!==1||!matching.length||lower[0].groups.length!==1||
        !playedValues.some(v=>lower[0].value+v===requestedValue))
        return {ok:false,reason:'Raise one single build and merge only matching-value builds.'};
      const extra=loose.length?findValuePartition(loose,requestedValue,'any',rules):[];
      if(!extra)return {ok:false,reason:'Table cards must form complete matching groups.'};
      const groups=[...matching.flatMap(b=>b.groups),lower[0].groups[0].concat(card),...extra];
      return {ok:true,build:{value:requestedValue,groups,kind:'multiple',operation:'merge'}};
    }
    if(requestedMode==='merge')return {ok:false,reason:'Select a single build to raise and a matching build to merge.'};
    if (!builds.length) {
      if (!loose.length && !rules.singleCardBuild) return {ok:false,reason:'Select at least one table card to build.'};
      let groups = findValuePartition([{card}, ...loose], requestedValue,
        requestedMode === 'single' ? 'single' : requestedMode === 'multiple' ? 'multiple' : 'any', rules);
      if(!groups&&rules.subtractiveBuilds&&loose.length===1&&requestedMode!=='multiple'&&playedValues.some(v=>cardValues(loose[0].card,rules).some(w=>Math.abs(w-v)===requestedValue)))groups=[[card,loose[0].card]];
      if (!groups) return {ok:false,reason:'Selected cards do not form the requested build.'};
      if (groups.length > 1 && !rules.multipleBuilds) return {ok:false,reason:'Multiple builds are disabled.'};
      return {ok:true,build:{value:requestedValue,groups,kind:groups.length===1?'single':'multiple',operation:'create'}};
    }
    const current = builds[0];
    if (requestedValue === current.value && requestedMode !== 'raise') {
      if (!rules.multipleBuilds) return {ok:false,reason:'Multiple builds are disabled.'};
      const groups = findValuePartition([{card}, ...loose], current.value, 'any', rules);
      if (!groups) return {ok:false,reason:'The additional group must equal the build value.'};
      return {ok:true,build:{value:current.value,groups:current.groups.concat(groups),kind:'multiple',operation:'extend'}};
    }
    if (requestedMode === 'extend') return {ok:false,reason:'Extending preserves the build value.'};
    if (current.groups.length > 1) return {ok:false,reason:'A multiple build cannot be raised.'};
    if (!playedValues.some(v => current.value + v === requestedValue || rules.subtractiveBuilds&&current.value-v===requestedValue)) {
      return {ok:false,reason:'The played card must change this build to its new value.'};
    }
    const extraGroups = loose.length ? findValuePartition(loose, requestedValue, 'any', rules) : [];
    if (!extraGroups) return {ok:false,reason:'Table cards must form extra complete groups when raising.'};
    if (extraGroups.length && !rules.multipleBuilds) return {ok:false,reason:'Multiple builds are disabled.'};
    return {ok:true,build:{value:requestedValue,groups:[current.groups[0].concat(card),...extraGroups],kind:extraGroups.length?'multiple':'single',operation:requestedValue<current.value?'lower':'raise'}};
  }
  function validateAction(state, action, skipPolicies = false) {
    if (!state || state.phase !== 'playing') return { ok: false, reason: 'This hand has ended.' };
    if (!action || !['capture', 'trail', 'build'].includes(action.kind)) return { ok: false, reason: 'Unknown move.' };
    const player = state.turn;
    const hand = state.players[player].hand;
    const card = hand.find(c => c.id === action.cardId);
    if (!card) return { ok: false, reason: 'Choose a card from your hand.' };
    const selectedIds = action.targetIds || [];
    if (new Set(selectedIds).size !== selectedIds.length) return { ok: false, reason: 'Duplicate table selection.' };
    const selected = selectedIds.map(id => state.table.find(e => e.id === id));
    if (selected.some(x => !x)) return { ok: false, reason: 'That table selection is no longer available.' };
    const remainingHand = hand.filter(c => c.id !== card.id);
    // An owner without a matching card under Build To Anything must not be trapped.
    const own = state.table.filter(e => e.type === 'build' && e.owner === player &&
      (!state.rules.buildAnything || hasValue(hand, e.value, state.rules)));
    const remainingTable = state.table.filter(e => !selectedIds.includes(e.id));
    let outcome;
    if (action.kind === 'trail') {
      if (selected.length) return { ok: false, reason: 'Deselect table cards before trailing.' };
      if (!state.rules.allowTrailWithOwnBuild && own.length) {
        return { ok: false, reason: 'You cannot trail while owning an active build.' };
      }
      outcome = { ok: true };
    } else if (action.kind === 'capture') {
      // The reference app calls these relaxed restrictions Pirate Captures.
      if (own.length && !state.rules.pirateCaptures && !own.some(e => selectedIds.includes(e.id))) {
        return {ok:false,reason:'Capture your own build first, or enable Pirate Captures.'};
      }
      outcome = describeCapture(selected, card, state.rules);
    } else {
      if (own.length && !state.rules.pirateBuilds && !own.some(e => selectedIds.includes(e.id))) {
        return {ok:false,reason:'Finish your current build first, or enable Pirate Builds.'};
      }
      outcome = describeBuild(selected, card, remainingHand, state.rules, action.value, action.mode);
      if(outcome.ok){
        const changed=selected.filter(e=>e.type==='build'&&e.value!==outcome.build.value);
        if(changed.some(e=>e.owner===player?state.rules.raiseOwnBuild===false:state.rules.raiseOpponentBuild===false))
          return {ok:false,reason:'Changing the value of that owner’s build is disabled.'};
        if(state.rules.mergeSameValue&&remainingTable.some(e=>e.type==='build'&&e.value===outcome.build.value))
          return {ok:false,reason:'Combine all same-value builds in this move.'};
        if(state.rules.absorbMatching&&remainingTable.some(e=>e.type==='loose'&&cardValues(e.card,state.rules).includes(outcome.build.value)))
          return {ok:false,reason:'Combine all individual table cards with the same value as the build.'};
        if(state.rules.buildLimit&&state.rules.buildLimit!=='unlimited'&&remainingTable.filter(e=>e.type==='build'&&e.owner===player).length+1>Number(state.rules.buildLimit))
          return {ok:false,reason:'The independent build limit has been reached.'};
      }
    }
    if (!outcome.ok) return outcome;
    if(action.kind==='capture'&&state.rules.directPriority&&state.rules.directCapture!==false){
      const vals=cardValues(card,state.rules);
      const matching=state.table.filter(x=>x.type==='loose'&&(vals.length?cardValues(x.card,state.rules).some(v=>vals.includes(v)):rankMatch(x.card,card,state.rules)));
      if(matching.length&&(selected.length!==1||!matching.some(x=>x.id===selected[0].id)))return {ok:false,reason:'A direct matching card takes priority over sums.'};
    }
    const resultTable = action.kind === 'trail'
      ? [...state.table, { id: 'preview', type: 'loose', card }]
      : action.kind === 'capture' ? remainingTable
      : [...remainingTable, { id: 'preview', type: 'build', value: outcome.build.value, groups: outcome.build.groups, owner: player }];
    const obligation = ownBuildObligation(state, resultTable, remainingHand, player);
    if (obligation) return { ok: false, reason: obligation };
    if(!skipPolicies){const policy=capturePolicy(state,action,card,selected);if(policy)return {ok:false,reason:policy};}
    return { ...outcome, card, selected, remainingTable };
  }
  // Label the resulting stack, never the rank of the card being played.
  // All currently legal builds have numerical targets. If a future rule
  // supports non-numerical face-rank builds, their target can be J, Q or K.
  function buildActionLabel(_card, value, build, _rules) {
    const title = build.operation === 'lower' ? 'Lower to' : build.operation === 'raise' ? 'Raise to'
      : build.kind === 'multiple' ? 'Multiple Build' : 'Build';
    return `${title} ${value}`;
  }
  function legalBuildOptions(state, cardId, targetIds) {
    if (!state.rules.builds || !cardId) return [];
    const hand = state.players[state.turn].hand;
    const values = state.rules.buildAnything ? Array.from({length:maxBuildValue(state.rules)},(_,i)=>i+1) : [...new Set(hand.filter(c => c.id !== cardId).flatMap(c => cardValues(c, state.rules)))];
    const selection = (targetIds || []).map(id => state.table.find(e => e.id === id));
    const buildCount=selection.filter(e=>e&&e.type==='build').length;
    const possibilities = [];
    for (const value of values) {
      for (const mode of buildCount>1 ? ['merge'] : buildCount ? ['extend', 'raise'] : ['single', 'multiple']) {
        const action = { kind: 'build', cardId, targetIds: targetIds || [], value, mode };
        const check = validateAction(state, action);
        if (check.ok) {
          const label = buildActionLabel(hand.find(c => c.id === cardId), value, check.build, state.rules);
          possibilities.push({...action,label,detail:check.build.kind});
        }
      }
    }
    return possibilities;
  }
  // The contextual menu may offer a merge with the player's existing
  // equal-valued build even when only the smaller build is selected.
  // The actual action always includes every consumed stack explicitly.
  function contextualBuildOptions(state,cardId,targetIds){
    const options=legalBuildOptions(state,cardId,targetIds);
    if(!state.rules.builds||!state.rules.multipleBuilds)return options;
    const ids=targetIds||[];
    const selected=state.table.filter(b=>b.type==='build'&&ids.includes(b.id));
    if(selected.length!==1||selected[0].groups.length!==1)return options;
    const card=state.players[state.turn].hand.find(c=>c.id===cardId);
    if(!card)return options;
    for(const value of cardValues(card,state.rules).map(v=>v+selected[0].value)){
      const matching=state.table.filter(b=>b.type==='build'&&b.owner===state.turn&&b.value===value&&!ids.includes(b.id));
      // Prefer the existing matching stack as the visual base.
      if(matching.length)options.push(...legalBuildOptions(state,cardId,[...matching.map(b=>b.id),...ids])
        .filter(move=>move.mode==='merge'&&move.value===value));
    }
    return options;
  }
  function applyAction(state, action) {
    const checked = validateAction(state, action);
    if (!checked.ok) return { ok: false, reason: checked.reason };
    const playerIndex = state.turn;
    const player = state.players[playerIndex];
    const opponent = state.players[1 - playerIndex];
    player.hand = player.hand.filter(c => c.id !== action.cardId);
    const played = checked.card;
    let description, swept=false;
    if (action.kind === 'trail') {
      state.table.push({ id: `t${state.nextId++}`, type: 'loose', card: played });
      description = `${player.name} trailed ${cardName(played)}.`;
    } else if (action.kind === 'capture') {
      state.table = checked.remainingTable;
      const won = [played, ...checked.selected.flatMap(cardsInElement)];
      player.captured.push(...won);
      state.lastCapture = playerIndex;
      swept = state.table.length === 0;
      const scoredSweep=swept&&!(state.rules.ignoreOpeningSweep&&state.moveNumber===0)&&!(state.rules.ignoreFinalSweep&&!state.stock.length&&!player.hand.length&&!opponent.hand.length);
      if (scoredSweep) player.sweeps += 1;
      description = `${player.name} captured ${won.length - 1} table card${won.length === 2 ? '' : 's'} with ${cardName(played)}${scoredSweep ? ' — sweep!' : '.'}`;
    } else {
      state.table = checked.remainingTable;
      state.table.push({ id: `t${state.nextId++}`, type: 'build', value: checked.build.value, groups: checked.build.groups, owner: playerIndex });
      const op = { create: 'built', lower: 'lowered a build to', raise: 'raised a build to', extend: 'extended a build of', merge: 'merged builds of' }[checked.build.operation];
      description = `${player.name} ${op} ${checked.build.value} (${checked.build.kind}).`;
    }
    state.moveNumber++;
    state.lastAction = description;
    state.log.push(description);
    if (state.log.length > 35) state.log.shift();
    state.lastActor=playerIndex;
    state.turn = 1 - playerIndex;
    if(state.rules.extraAfterSweep){
      if(swept)state.extraTurnFor=state.turn;
      else if(state.extraTurnFor===playerIndex){state.turn=playerIndex;state.extraTurnFor=null;}
    }
    // Draw Cassino: the player who just played immediately replenishes their hand.
    // Ordinary Cassino waits until both four-card hands have been played.
    if ((state.rules.drawMode || state.rules.dealMode==='draw') && state.stock.length && player.hand.length < (state.rules.handSize||4)) {
      player.hand.push(state.stock.pop());
      state.lastAction += ' Replacement card drawn.';
    }

    if (!player.hand.length && !opponent.hand.length) {
      if (state.stock.length) {
        drawCards(state);
        state.lastAction += ' New cards dealt.';
      } else {
        finishHand(state);
      }
    }
    if(state.phase==='playing'&&!state.players[state.turn].hand.length){
      if(state.extraTurnFor===state.turn)state.extraTurnFor=null;
      state.turn=1-state.turn;
    }
    return { ok: true, description };
  }
  function scoreSpec(rules){
    const base={cards:3,suit:'S',suitPoints:1,perSpade:!!rules.spadeScoring,big:'D10',bigPoints:2,little:'S2',littlePoints:1,ace:1,face:0,tens:0,prime:0};
    const schemes={
      wippen:{cards:2,suitPoints:2,perSpade:false},
      diloti:{cards:4,suitPoints:0,perSpade:false,little:'C2'},
      kontsina:{cards:2,suit:'C',suitPoints:1,perSpade:false,bigPoints:1,little:'C2',ace:0},
      tablic:{suitPoints:0,perSpade:false,little:'C2',face:1,tens:1},
      scopa:{cards:1,suit:'D',suitPoints:1,perSpade:false,big:'D7',bigPoints:1,littlePoints:0,ace:0,prime:1}
    };
    return {...base,...(schemes[rules.scoreProfile]||{})};
  }
  const symbol=s=>({S:'♠',H:'♥',C:'♣',D:'♦'})[s]||s;
  const bonusLabel=id=>id.slice(1)+symbol(id[0]);
  function scoreCategories(rules){
    const s=scoreSpec(rules),rows=[['cards','Most cards ('+s.cards+')']];
    if(s.perSpade)rows.push(['spades','Spades (1 each; J♠ bonus)']);
    else if(s.suitPoints)rows.push(['spades','Most '+({S:'spades',C:'clubs',D:'diamonds',H:'hearts'})[s.suit]+' ('+s.suitPoints+')']);
    if(s.bigPoints)rows.push(['big',bonusLabel(s.big)+' ('+s.bigPoints+')']);
    if(s.littlePoints)rows.push(['little',bonusLabel(s.little)+' ('+s.littlePoints+')']);
    if(s.ace)rows.push(['aces','Aces ('+s.ace+' each)']);
    if(s.face)rows.push(['faces','Face cards ('+s.face+' each)']);
    if(s.tens)rows.push(['tens','Other tens ('+s.tens+' each)']);
    if(s.prime)rows.push(['prime','Primiera ('+s.prime+')']);
    rows.push(['sweeps','Sweeps ('+(rules.sweepPoints||0)+(rules.sweepCancel?', net':'')+')'],['total','This hand (total)']);
    return rows;
  }
  function primeValue(pile){
    const value={1:16,2:12,3:13,4:14,5:15,6:18,7:21,11:10,12:10,13:10};
    const best=SUITS.map(s=>Math.max(0,...pile.filter(c=>c.suit===s).map(c=>value[c.rank]||10)));
    return best.every(Boolean)?best.reduce((a,b)=>a+b,0):0;
  }
  function specialPoints(card,s){
    return (card.id===s.big?s.bigPoints:0)+(card.id===s.little?s.littlePoints:0)+(card.rank===1?s.ace:card.rank>=11&&card.rank<=13?s.face:card.rank===10&&card.id!==s.big?s.tens:0)+(s.perSpade&&card.suit==='S'?(card.rank===11?2:1):0);
  }
  function scoreHand(state){
    const s=scoreSpec(state.rules),piles=state.players.map(p=>p.captured);
    const counts=piles.map(p=>p.length),spades=piles.map(p=>p.filter(c=>c.suit==='S').length);
    const suitCounts=piles.map(p=>p.filter(c=>c.suit===s.suit).length),primes=piles.map(primeValue);
    return [0,1].map(i=>{
      const p=piles[i],other=1-i;
      const cards=counts[i]>counts[other]?s.cards:0;
      const spadesPoints=s.perSpade?spades[i]+(p.some(c=>c.id==='S11')?1:0):suitCounts[i]>suitCounts[other]?s.suitPoints:0;
      const big=p.some(c=>c.id===s.big)?s.bigPoints:0,little=p.some(c=>c.id===s.little)?s.littlePoints:0;
      const aces=p.filter(c=>c.rank===1).length*s.ace,faces=p.filter(c=>c.rank>=11&&c.rank<=13).length*s.face;
      const tens=p.filter(c=>c.rank===10&&c.id!==s.big).length*s.tens;
      const prime=primes[i]>primes[other]?s.prime:0;
      const net=state.rules.sweepCancel?Math.max(0,state.players[i].sweeps-state.players[other].sweeps):state.players[i].sweeps;
      const sweeps=net*state.rules.sweepPoints;
      return {cards,spades:spadesPoints,big,little,aces,sweeps,total:cards+spadesPoints+big+little+aces+sweeps+faces+tens+prime,
        cardCount:counts[i],spadeCount:spades[i],sweepCount:state.players[i].sweeps,
        ...(s.face?{faces}:{}),...(s.tens?{tens}:{}),...(s.prime?{prime}:{})};
    });
  }
  function finishHand(state){
    const recipient=state.rules.residueOwner==='dealer'?state.dealer:state.lastCapture;
    if(state.table.length&&recipient!==null){
      state.players[recipient].captured.push(...state.table.flatMap(cardsInElement));
      state.lastAction+=' Remaining table cards awarded to '+state.players[recipient].name+'.';
    }else if(state.table.length){
      state.unclaimed=state.table.flatMap(cardsInElement);
      state.lastAction+=' No player captured; table residue is unclaimed.';
    }
    state.table=[];
    const totals=scoreHand(state);
    totals.forEach((row,i)=>{state.players[i].score+=row.total;});
    const scores=state.players.map(p=>p.score),fixed=Number(state.rules.matchDeals)||0;
    const reached=fixed?state.round>=fixed:scores.some(s=>s>=state.rules.winningScore);
    const winner=reached&&scores[0]!==scores[1]?(scores[0]>scores[1]?0:1):null;
    state.phase=reached&&(fixed||winner!==null)?'gameOver':'roundOver';
    state.result={points:totals,scores,winner,finishedRound:state.round,categories:scoreCategories(state.rules)};
  }
  function nextHand(state, random = Math.random) {
    if (state.phase !== 'roundOver') return null;
    return makeState(state.rules, 1 - state.dealer, state.players.map(p => p.score), state.round + 1, random);
  }
  // All table-card subsets whose sum is value. Pruned by positive card values.
  function valueGroups(state, target, max = 160) {
    const matching = state.table.filter(e => e.type === 'build' && e.value === target).map(e => [e.id]);
    const loose = state.table.filter(e => e.type === 'loose' && cardValues(e.card,state.rules).length || state.rules.additiveBuilds&&e.type==='build'&&e.groups.length===1&&e.value<target)
      .map(e => ({id:e.id, vals:e.type==='build'?[e.value]:cardValues(e.card,state.rules)}));
    const seen = new Set(matching.map(group=>group.join(',')));
    const go = (start,total,chosen) => {
      if (matching.length >= max) return;
      if (total === target) {
        const key = chosen.join(',');
        if (!seen.has(key)) {seen.add(key); matching.push([...chosen]);}
        return;
      }
      for (let i = start; i < loose.length; i++) {
        for (const v of loose[i].vals) {
          if (total + v > target) continue;
          go(i+1,total+v,[...chosen,loose[i].id]);
          if (matching.length >= max) return;
        }
      }
    };
    go(0,0,[]);
    return matching;
  }
  function captureChoices(state, card, limit = 110) {
    const values = cardValues(card, state.rules);
    if (!values.length) {
      return state.table.filter(e => e.type === 'loose' && rankMatch(e.card,card,state.rules)).map(e => ({ kind: 'capture', cardId: card.id, targetIds: [e.id] }));
    }
    const moves = [];
    const visited = new Set();
    const add = picked => {
      const ids = [...picked].sort();
      const key = ids.join(',');
      if (!visited.has(key) && moves.length < limit) {
        visited.add(key);
        moves.push({ kind: 'capture', cardId: card.id, targetIds: ids });
      }
    };
    // Keep alternate numerical values separate: mixed-value groups are illegal.
    const groupSets = values.map(v => valueGroups(state, v));
    for (const groups of groupSets) {
      const builds = groups.filter(g => g.length === 1 && state.table.some(e => e.id === g[0] && e.type === 'build'));
      if (builds.length) add(builds.flat());
      if (groups.length) add(groups[0]);
    }
    for (const groups of groupSets) {
      const combine = (start, picked) => {
        if (moves.length >= limit) return;
        if (picked.length) add(picked);
        for (let i = start; i < groups.length; i++) {
          if (groups[i].some(id => picked.includes(id))) continue;
          combine(i + 1, picked.concat(groups[i]));
          if (moves.length >= limit) break;
        }
      };
      combine(0, []);
    }
    return moves;
  }
  function buildChoices(state, card, max = 55) {
    if (!state.rules.builds || cardValue(card, state.rules) === null) return [];
    const relevant = state.table.filter(e => e.type === 'loose' && cardValue(e.card, state.rules) !== null);
    const builds = state.table.filter(e => e.type === 'build');
    const targetSets = [];
    const collect = (start, picked, bound) => {
      if (picked.length) targetSets.push([...picked]);
      if (picked.length >= bound || targetSets.length >= 120) return;
      for (let i = start; i < relevant.length; i++) collect(i + 1, [...picked, relevant[i].id], bound);
    };
    collect(0, [], 3);
    if(state.rules.singleCardBuild)targetSets.push([]);
    for (const b of builds) {
      targetSets.push([b.id]);
      for (const l of relevant) targetSets.push([b.id, l.id]);
      if(b.groups.length===1&&state.rules.multipleBuilds)for(const other of builds){
        if(other===b||!cardValues(card,state.rules).some(v=>b.value+v===other.value))continue;
        targetSets.push([other.id,b.id]);
        for(const l of relevant)targetSets.push([other.id,b.id,l.id]);
      }
    }
    const moves = [];
    const keys = new Set();
    for (const ids of targetSets) {
      for (const option of legalBuildOptions(state, card.id, ids)) {
        const key = [option.value, option.mode, ...option.targetIds].join('/');
        if (!keys.has(key)) { keys.add(key); moves.push(option); }
        if (moves.length >= max) return moves;
      }
    }
    return moves;
  }
  function allComputerMoves(state, limit = 500) {
    const moves = [];
    for (const card of state.players[state.turn].hand) {
      const trail = { kind: 'trail', cardId: card.id, targetIds: [] };
      if (validateAction(state, trail).ok) moves.push(trail);
      for (const move of captureChoices(state, card)) if (validateAction(state, move).ok) moves.push(move);
      for (const move of buildChoices(state, card)) moves.push(move);
      if (moves.length >= limit) break;
    }
    return moves;
  }
  function moveScore(state, move) {
    const card = state.players[state.turn].hand.find(c => c.id === move.cardId);
    if (move.kind === 'capture') {
      const selection = state.table.filter(e => move.targetIds.includes(e.id));
      const cards = [card, ...selection.flatMap(cardsInElement)];
      const swept = selection.length === state.table.length;
      const spec=scoreSpec(state.rules);
      const specials=state.rules.scoreProfile&&state.rules.scoreProfile!=='cassino'?cards.reduce((n,c)=>n+2*specialPoints(c,spec)+(c.suit===spec.suit?spec.suitPoints*.55:0)+(spec.prime&&c.rank===7?1.5:0),0):cards.reduce((s, c) => s + (c.id === 'D10' ? 4.1 : 0) + (c.id === 'S2' ? 2.7 : 0) + (c.rank === 1 ? 1.8 : 0) + (c.suit === 'S' ? state.rules.spadeScoring ? 1.2 : 0.55 : 0), 0);
      return 3 + (cards.length - 1) * 1.3 + specials + (swept ? 3.2 + state.rules.sweepPoints * 2 : 0) + selection.filter(e => e.type === 'build').length * 1.1;
    }
    if (move.kind === 'build') {
      const chosen = state.table.filter(e => move.targetIds.includes(e.id));
      const consumed = chosen.flatMap(cardsInElement);
      const risk = 1.2 + Math.max(0, state.players[1 - state.turn].hand.length - 2) * 0.3;
      return 1.5 + consumed.length * 0.6 + (consumed.some(c => c.id === 'D10') ? 1.5 : 0) - risk;
    }
    const v = cardValue(card, state.rules) || 11;
    if(state.rules.scoreProfile&&state.rules.scoreProfile!=='cassino')return -.1-2*specialPoints(card,scoreSpec(state.rules))-(v>=8?.35:0);
    return -0.1 - (card.id === 'D10' ? 4 : 0) - (card.id === 'S2' ? 2 : 0) - (card.rank === 1 ? 1.1 : 0) - (v >= 8 ? 0.35 : 0);
  }
  function chooseComputerMove(state, random = Math.random) {
    if(state.rules.difficulty==='hard'||state.rules.difficulty==='expert')
      return analyzeComputerMove(publicPosition(state),{random}).move;
    const options = allComputerMoves(state);
    if (!options.length) {const fallback=legalActions(state).next();if(!fallback.done)return fallback.value;throw new Error('No legal moves for computer.');}
    if (state.rules.difficulty === 'casual') {
      // Casual computer mostly captures, but not necessarily the best combination.
      const captures = options.filter(m => m.kind === 'capture');
      if (captures.length && random() < 0.78) return captures[Math.floor(random() * captures.length)];
      return options[Math.floor(random() * options.length)];
    }
    // Stable maximum: identical scoring, random calls and tie order as
    // the former sort, without allocating and sorting a second move list.
    let best=options[0],bestScore=-Infinity;
    for(const move of options){
      const score=moveScore(state,move)+random()*.6;
      if(score>bestScore){best=move;bestScore=score;}
    }
    return best;
  }
  // Yield candidate subsets whose possible numerical sum is a multiple of
  // the target. The suffix residue masks prune impossible branches, without
  // limiting the number of cards or the number of legal results.
  function* hintSubsets(entries, target, initialValues, allowEmpty = false, stop=()=>false) {
    const suffix=Array(entries.length+1);
    suffix[entries.length]=new Set([0]);
    for(let i=entries.length-1;i>=0;i--){
      const after=suffix[i+1];
      suffix[i]=new Set(after);
      for(const value of entries[i].values) for(const residue of after)
        suffix[i].add((value+residue)%target);
    }
    function* walk(start, residues, ids){
      if(stop())return;
      if((ids.length||allowEmpty)&&residues.has(0)) yield ids;
      for(let i=start;i<entries.length&&!stop();i++){
        const next=new Set();
        for(const residue of residues) for(const value of entries[i].values)
          next.add((residue+value)%target);
        if(![...next].some(r=>suffix[i+1].has((target-r)%target)))continue;
        yield* walk(i+1,next,[...ids,entries[i].id]);
      }
    }
    yield* walk(0,new Set(initialValues.map(v=>v%target)),[]);
  }

  // Exhaustive legal action generation shares the same validator as manual
  // play. Optional interruption bounds search in pathological positions.
  // Hints collapse identical visible selections, AI keeps distinct actions.
  function* legalActions(state,stop=()=>false,visibleOnly=false) {
    if(!state||state.phase!=='playing')return;
    const hand=state.players[state.turn].hand;
    const rules=state.rules;
    const loose=state.table.filter(x=>x.type==='loose');
    const builds=state.table.filter(x=>x.type==='build');
    const seen=new Set();
    const key=(cardId,ids)=>JSON.stringify([cardId,[...ids].sort()]);
    function unique(move){
      const selection=key(move.cardId,move.targetIds||[]);
      const k=visibleOnly?selection:JSON.stringify([selection,move.kind,move.value,move.mode]);
      if(seen.has(k))return false;
      seen.add(k);return true;
    }
    const numericEntries=target=>loose.map(x=>({id:x.id,
      values:cardValues(x.card,rules).filter(v=>v<=target)})).filter(x=>x.values.length);
    for(const card of hand){
      if(stop())return;
      const values=cardValues(card,rules);
      if(!values.length){
        for(const item of loose){
          if(stop())return;
          if(!rankMatch(item.card,card,rules))continue;
          const move={kind:'capture',cardId:card.id,targetIds:[item.id]};
          if(validateAction(state,move).ok&&unique(move))yield move;
        }
        continue;
      }
      for(const target of values){
        const entries=[...builds.filter(b=>b.value===target||rules.additiveBuilds&&b.groups.length===1&&b.value<target).map(b=>({id:b.id,values:[b.value]})),
          ...numericEntries(target)];
        for(const ids of hintSubsets(entries,target,[0],false,stop)){
          const move={kind:'capture',cardId:card.id,targetIds:ids};
          if(validateAction(state,move).ok&&unique(move))yield move;
        }
      }
    }
    if(rules.builds)for(const card of hand){
      if(stop())return;
      const played=cardValues(card,rules);
      if(!played.length)continue;
      const targets=rules.buildAnything
        ? Array.from({length:maxBuildValue(rules)},(_,i)=>i+1)
        : [...new Set(hand.filter(c=>c.id!==card.id).flatMap(c=>cardValues(c,rules)))];
      function* options(ids,target){
        if(stop()||(visibleOnly&&seen.has(key(card.id,ids))))return;
        for(const move of legalBuildOptions(state,card.id,ids)){
          if(move.value===target&&unique(move))yield move;
        }
      }
      for(const target of targets){
        if(stop())return;
        const entries=numericEntries(target);
        const values=played.filter(v=>v<=target);
        if(rules.singleCardBuild)yield* options([],target);
        if(rules.subtractiveBuilds)for(const item of loose)yield* options([item.id],target);
        if(!values.length&&!rules.subtractiveBuilds)continue;
        for(const ids of hintSubsets(entries,target,values,false,stop))yield* options(ids,target);
        for(const build of builds){
          if(stop())return;
          const extend=rules.multipleBuilds&&build.value===target;
          const raise=build.groups.length===1&&played.some(v=>build.value+v===target||rules.subtractiveBuilds&&build.value-v===target);
          if(!extend&&!raise)continue;
          const initial=extend?values:played.filter(v=>build.value+v===target||rules.subtractiveBuilds&&build.value-v===target).map(v=>build.value+v===target?v:-v);
          // When raising, matching existing builds can be included as
          // intact groups. They never contribute to the increase in value.
          const matching=raise&&rules.multipleBuilds?builds.filter(b=>b!==build&&b.value===target)
            .map(b=>({id:b.id,values:[target]})):[];
          for(const extra of hintSubsets(entries,target,initial.map(v=>extend?v+build.value:target),true,stop))
            yield* options([build.id,...extra],target);
          if(matching.length){
            for(const extra of hintSubsets([...matching,...entries],target,[0],false,stop)){
              if(!matching.some(b=>extra.includes(b.id)))continue;
              yield* options([...extra.filter(id=>matching.some(b=>b.id===id)),build.id,...extra.filter(id=>!matching.some(b=>b.id===id))],target);
            }
          }
        }
      }
    }
    for(const card of hand){
      if(stop())return;
      const move={kind:'trail',cardId:card.id,targetIds:[]};
      if(validateAction(state,move).ok&&unique(move))yield move;
    }
  }
  function* hintSelections(state){yield* legalActions(state,()=>false,true);}

  // Strong opponents receive a detached, public-information-only view.
  // The other hand and stock are represented by counts, never actual IDs.
  function publicPosition(state){
    const root=state.turn;
    const players=state.players.map((p,i)=>({
      name:p.name,score:p.score,sweeps:p.sweeps,captured:p.captured,
      handCount:p.hand.length,...(i===root?{hand:p.hand}:{})
    }));
    return JSON.parse(JSON.stringify({rules:state.rules,players,table:state.table,
      stockCount:state.stock.length,turn:root,lastCapture:state.lastCapture,extraTurnFor:state.extraTurnFor,lastActor:state.lastActor,
      nextId:state.nextId,moveNumber:state.moveNumber,dealer:state.dealer,
      round:state.round,phase:state.phase}));
  }
  // Draw a plausible hidden world from the unseen deck. Public build
  // obligations constrain the opponent's hand; reserve distinct cards.
  // With an exhausted stock the remaining unseen cards determine the hand.
  function samplePublicPosition(view,random=Math.random){
    const root=view.turn,other=1-root;
    const known=new Set([
      ...view.players[root].hand,
      ...view.players.flatMap(p=>p.captured),
      ...view.table.flatMap(cardsInElement)
    ].map(c=>c.id));
    const pool=shuffle(makeDeck(view.rules).filter(c=>!known.has(c.id)),random);
    const count=view.players[other].handCount;
    const obligations=view.rules.buildAnything?[]:view.table.filter(b=>b.type==='build'&&b.owner===other)
      .map(b=>({value:b.value,choices:pool.map((c,i)=>cardValues(c,view.rules).includes(b.value)?i:-1).filter(i=>i>=0)}))
      .sort((a,b)=>a.choices.length-b.choices.length);
    const reserved=new Set();
    function reserve(i){
      if(i===obligations.length)return true;
      for(const index of obligations[i].choices){
        if(reserved.has(index))continue;
        reserved.add(index);
        if(reserve(i+1))return true;
        reserved.delete(index);
      }
      return false;
    }
    if(obligations.length>count||!reserve(0))return null;
    const hidden=[...reserved].map(i=>pool[i]);
    const remaining=pool.filter((_,i)=>!reserved.has(i));
    hidden.push(...remaining.splice(0,count-hidden.length));
    if(hidden.length!==count||remaining.length<view.stockCount)return null;
    const players=view.players.map((p,i)=>({name:p.name,score:p.score||0,sweeps:p.sweeps||0,
      captured:p.captured.slice(),hand:(i===root?p.hand:hidden).slice()}));
    return {rules:view.rules,players,table:view.table.slice(),stock:remaining.slice(0,view.stockCount),
      turn:root,lastCapture:view.lastCapture,extraTurnFor:view.extraTurnFor,lastActor:view.lastActor,nextId:view.nextId,moveNumber:view.moveNumber,
      dealer:view.dealer,round:view.round,phase:view.phase,result:null,lastAction:'',log:[]};
  }
  // Cheap legal safety move: direct captures (including owned builds), then
  // a legal trail. A valid state always permits one or the other. No hidden
  // cards are read, even when the worker is unavailable or times out.
  function quickLegalMove(state){
    let best=null,bestScore=-Infinity;
    for(const card of state.players[state.turn].hand){
      const offer=move=>{
        if(!validateAction(state,move).ok)return;
        const score=moveScore(state,move);
        if(score>bestScore){best=move;bestScore=score;}
      };
      offer({kind:'trail',cardId:card.id,targetIds:[]});
      for(const item of state.table)offer({kind:'capture',cardId:card.id,targetIds:[item.id]});
    }
    if(best)return best;
    const fallback=legalActions(state).next();if(!fallback.done)return fallback.value;
    // Corrupt/legacy states can lack a simple move; do not invent an illegal one.
    throw new Error('No simple legal move in the current position.');
  }
  function simulationCopy(state){
    // Cards, groups and rules are immutable during applyAction. Only copy
    // the containers it mutates, not the entire serialized match history.
    return {...state,players:state.players.map(p=>({...p,hand:p.hand.slice(),captured:p.captured.slice()})),
      stock:state.stock.slice(),table:state.table.slice(),log:[]};
  }
  const tacticalWorth=c=>.11+(c.rank===1?1:0)+(c.id==='D10'?2:0)+(c.id==='S2'?1:0)+(c.suit==='S'?.14:0);
  function strategicValue(state,root){
    const other=1-root,p=state.players[root],q=state.players[other],rules=state.rules;
    if(state.phase!=='playing'){
      const margin=p.score-q.score;
      const terminal=state.result?.winner;
      return margin+(state.phase==='gameOver'?(terminal===root?100:terminal===other?-100:0):0);
    }
    const spec=scoreSpec(rules);
    function tally(pile){
      let spades=0,special=0;
      for(const c of pile){
        if(c.suit==='S'){spades++;if(rules.spadeScoring&&c.id==='S11')special++;}
        special+=(c.rank===1?1:0)+(c.id==='D10'?2:0)+(c.id==='S2'?1:0);
      }
      if(rules.scoreProfile&&rules.scoreProfile!=='cassino')return {count:pile.length,spades:pile.filter(c=>c.suit===spec.suit).length,special:pile.reduce((n,c)=>n+specialPoints(c,spec),0),prime:primeValue(pile)};
      return {count:pile.length,spades,special,prime:0};
    }
    const a=tally(p.captured),b=tally(q.captured);
    const deck=makeDeck(rules),remaining=Math.max(0,deck.length-a.count-b.count),remainingSpades=Math.max(0,deck.filter(c=>c.suit===spec.suit).length-a.spades-b.spades);
    const majority=(diff,left,points)=>{
      if(diff>left)return points;
      if(diff< -left)return -points;
      if(!left)return Math.sign(diff)*points;
      return points*Math.tanh(diff/Math.max(1,left*.26));
    };
    let score=p.score-q.score+a.special-b.special+majority(a.count-b.count,remaining,spec.cards)
      +(spec.perSpade?a.spades-b.spades:majority(a.spades-b.spades,remainingSpades,spec.suitPoints))+(spec.prime?Math.tanh((a.prime-b.prime)/30)*spec.prime:0)
      +(p.sweeps-q.sweeps)*rules.sweepPoints+.045*(a.count-b.count);
    const vals=state.players.map(pl=>pl.hand.map(c=>cardValues(c,rules)));
    const matches=(i,v)=>vals[i].some(values=>values.includes(v));
    // Possible loose sums and exact build values, for mobility, capture
    // potential and preserving flexible cards. A bitset avoids subset copies.
    let sums=1;
    const highest=maxBuildValue(rules);
    const buildValues=new Set(),faces=new Set();
    let tableWorth=0;
    for(const item of state.table){
      if(item.type==='loose'){
        const values=cardValues(item.card,rules);
        const old=sums;
        for(const v of values)sums|=old<<v;
        sums&=0x7fffffff; // values 1–30; bit 0 represents an empty sum
        if(!values.length)faces.add(item.card.rank);
        tableWorth+=tacticalWorth(item.card);
        continue;
      }
      buildValues.add(item.value);
      const worth=cardsInElement(item).reduce((sum,c)=>sum+tacticalWorth(c),0);
      tableWorth+=worth;
      const owner=item.owner,enemy=1-owner;
      const secured=matches(owner,item.value),stealable=matches(enemy,item.value);
      let raiseable=false;
      if(item.groups.length===1&&rules.builds){
        raiseable=vals[enemy].some((values,i)=>values.some(v=>
          v+item.value<=highest&&
          (rules.buildAnything||vals[enemy].some((rest,j)=>i!==j&&rest.includes(v+item.value)))));
      }
      const security=secured?(stealable?.04:raiseable?.20:.43):-.14;
      score+=(owner===root?1:-1)*(worth*security-.065);
    }
    for(let i=0;i<2;i++){
      const hand=state.players[i].hand,distinct=new Set();
      let mobility=0;
      for(let j=0;j<hand.length;j++){
        const values=vals[i][j];
        if(values.length){
          values.forEach(v=>distinct.add(v));
          if(values.some(v=>buildValues.has(v)||(sums&(1<<v))))mobility++;
        }else{
          distinct.add('face'+hand[j].rank);
          if(faces.has(hand[j].rank))mobility++;
        }
      }
      score+=(i===root?1:-1)*(.052*distinct.size+.105*mobility);
    }
    // Late-hand residue matters: favor retaining the last-capture right
    // when few actions remain. Search handles the actual award exactly.
    if(!state.stock.length&&state.lastCapture!==null){
      const left=p.hand.length+q.hand.length;
      score+=(state.lastCapture===root?1:-1)*tableWorth*.23/(1+left*.35);
    }
    return score;
  }
  // Hard and Expert share the same evaluator and imperfect-information
  // model. Root moves are exhaustive until an explicit safety budget;
  // deeper nonterminal branches are ranked/limited, with iterative search
  // over common sampled worlds. A partial iteration never replaces the
  // last completed one. Small perfect-information endgames can be exact.
  function analyzeComputerMove(view,options={}){
    const expert=view.rules.difficulty==='expert',root=view.turn;
    const random=options.random||Math.random,now=options.now||Date.now;
    const timeMs=options.timeMs??(expert?1500:650),maxNodes=options.maxNodes??(expert?18000:4800);
    const maxRoots=options.maxRoots??(expert?1800:900);
    const began=now(),deadline=began+timeMs;
    let nodes=0,rootTruncated=false,completedDepth=1,samplesUsed=0;
    const stopped=()=>nodes>=maxNodes||now()>=deadline;
    const sampleCount=view.stockCount===0?1:expert?5:3;
    const worlds=[];
    for(let i=0;i<sampleCount;i++){
      const world=samplePublicPosition(view,random);
      if(world)worlds.push(world);
    }
    if(!worlds.length)throw new Error('No plausible hidden hand satisfies the public position.');
    const baseline=worlds[0];
    const fallback=quickLegalMove(baseline);
    const advance=(state,move)=>{
      if(stopped())return null;
      nodes++;
      const child=simulationCopy(state);
      return applyAction(child,move).ok?child:null;
    };
    const rootKey=m=>JSON.stringify([m.kind,m.cardId,[...m.targetIds].sort(),m.value,m.mode]);
    const seen=new Set(),roots=[];
    const rootSamples=Math.min(worlds.length,expert?3:2);
    const rootStopped=()=>{
      const stop=stopped()||roots.length>=maxRoots||now()>=began+timeMs*.38;
      if(stop)rootTruncated=true;
      return stop;
    };
    const risk=(view.players[root].score||0)>(view.players[1-root].score||0)&&
      (view.players[root].score||0)>view.rules.winningScore*.65?.12:0;
    const aggregate=values=>{
      const mean=values.reduce((a,b)=>a+b,0)/values.length;
      return mean-risk*Math.sqrt(values.reduce((a,b)=>a+(b-mean)**2,0)/values.length);
    };
    function addRoot(move){
      const key=rootKey(move);
      if(seen.has(key)||stopped())return;
      seen.add(key);
      const values=[];
      for(let i=0;i<rootSamples;i++){
        const child=advance(worlds[i],move);
        if(!child)break;
        values.push(strategicValue(child,root));
      }
      if(values.length!==rootSamples)return;
      roots.push({move,score:aggregate(values)+.0001*moveScore(baseline,move)});
    }
    addRoot(fallback);
    // Keep legal trails in the candidate list even if a huge capture set
    // hits the root limit before the generator reaches its trailing phase.
    for(const c of baseline.players[root].hand){
      const move={kind:'trail',cardId:c.id,targetIds:[]};
      if(validateAction(baseline,move).ok)addRoot(move);
    }
    for(const move of legalActions(baseline,rootStopped)){
      if(rootStopped())break;
      addRoot(move);
    }
    if(!roots.length)return {move:fallback,nodes,rootMoves:0,rootTruncated:true,completedDepth:0,samplesUsed:0,exact:false};
    roots.sort((a,b)=>b.score-a.score);
    let best=roots[0].move,ranked=roots;
    samplesUsed=rootSamples;
    if(typeof options.onProgress==='function')options.onProgress(best);
    const handLeft=view.players.reduce((n,p)=>n+p.handCount,0);
    const perfect=view.stockCount===0&&worlds.length===1&&
      worlds[0].players[1-root].hand.length===view.players[1-root].handCount;
    const exhaustive=perfect&&!rootTruncated&&handLeft<=8&&roots.length<=100;
    const branchLimit=expert?120:90,beam=expert?8:6;
    function minimax(state,depth,alpha,beta){
      if(stopped())return null;
      if(depth===0||state.phase!=='playing')return strategicValue(state,root);
      const maximize=state.turn===root,children=[],keys=new Set();
      function offer(move){
        const k=rootKey(move);
        if(keys.has(k))return;
        keys.add(k);
        const child=advance(state,move);
        if(child)children.push({child,score:strategicValue(child,root)});
      }
      // Keep a safe move and all trails represented even when a sampled
      // position is wide; in exact endgames no branch beam is used.
      offer(quickLegalMove(state));
      for(const c of state.players[state.turn].hand){
        const move={kind:'trail',cardId:c.id,targetIds:[]};
        if(validateAction(state,move).ok)offer(move);
      }
      for(const move of legalActions(state,stopped)){
        if(stopped())return null;
        offer(move);
        if(!exhaustive&&children.length>=branchLimit)break;
      }
      if(stopped())return null;
      children.sort((a,b)=>maximize?b.score-a.score:a.score-b.score);
      if(!children.length)return strategicValue(state,root);
      const selected=exhaustive?children:children.slice(0,beam);
      let best=maximize?-Infinity:Infinity;
      for(const {child,score} of selected){
        const value=depth===1?score:minimax(child,depth-1,alpha,beta);
        if(value===null)return null;
        if(maximize){best=Math.max(best,value);alpha=Math.max(alpha,best);}
        else{best=Math.min(best,value);beta=Math.min(beta,best);}
        if(beta<=alpha)break;
      }
      return best;
    }
    const rounds=exhaustive&&expert
      ? Array.from({length:Math.max(0,handLeft-1)},(_,i)=>({depth:i+2,width:Infinity,count:1}))
      : expert?[{depth:2,width:16,count:4},{depth:3,width:8,count:3},{depth:4,width:5,count:2}]
        : [{depth:2,width:12,count:3}];
    for(const round of rounds){
      if(stopped())break;
      const candidates=exhaustive?ranked:ranked.slice(0,round.width);
      const count=Math.min(worlds.length,round.count);
      const scored=[];
      let complete=true;
      for(const candidate of candidates){
        const values=[];
        for(let i=0;i<count;i++){
          const child=advance(worlds[i],candidate.move);
          if(!child){complete=false;break;}
          const value=minimax(child,round.depth-1,-Infinity,Infinity);
          if(value===null){complete=false;break;}
          values.push(value);
        }
        if(!complete)break;
        scored.push({move:candidate.move,score:aggregate(values)});
      }
      if(!complete||scored.length!==candidates.length)break;
      scored.sort((a,b)=>b.score-a.score);
      ranked=scored;best=ranked[0].move;completedDepth=round.depth;samplesUsed=count;
      if(typeof options.onProgress==='function')options.onProgress(best);
      if(exhaustive&&completedDepth>=handLeft)break;
    }
    return {move:best,nodes,rootMoves:roots.length,rootTruncated,completedDepth,samplesUsed,
      exact:exhaustive&&completedDepth>=handLeft};
  }

  function explainMove(state, move) {
    if (move.kind === 'trail') return `Trail ${cardName(state.players[state.turn].hand.find(c => c.id === move.cardId))} onto the table.`;
    if (move.kind === 'capture') return `Capture ${move.targetIds.length} table group${move.targetIds.length === 1 ? '' : 's'} with ${cardName(state.players[state.turn].hand.find(c => c.id === move.cardId))}.`;
    return `${move.label || 'Build'} by combining your card with the selected table cards.`;
  }
  function checkInvariants(state){
    const expected=new Set(makeDeck(state.rules).map(c=>c.id));
    const cards=[...state.stock,...state.players.flatMap(p=>[...p.hand,...p.captured]),...state.table.flatMap(cardsInElement),...(state.unclaimed||[])];
    if(cards.length!==expected.size||new Set(cards.map(c=>c.id)).size!==expected.size||cards.some(c=>!expected.has(c.id)))return 'Card conservation failed.';
    if(state.phase==='playing'){
      if(!state.players[state.turn]?.hand.length)return 'Active player has no cards.';
      for(let i=0;i<state.players.length;i++){const error=ownBuildObligation(state,state.table,state.players[i].hand,i);if(error)return error;}
    }
    return null;
  }
  function simulateRules(input,count=20,seed=1){
    const validation=validateRules(input);
    if(!validation.playable)return {tested:0,completed:0,failures:[],validation};
    count=Math.max(1,Math.min(100,Math.floor(count)||20));let completed=0,zeroScore=0;
    const failures=[];
    for(let i=0;i<count;i++){
      const start=seed+i;let n=start>>>0,state;
      const random=()=>{n=(Math.imul(n,1664525)+1013904223)>>>0;return n/4294967296;};
      try{
        state=newMatch({...validation.rules,difficulty:'casual'},random);
        const max=makeDeck(state.rules).length;
        for(let step=0;state.phase==='playing'&&step<=max;step++){
          const invariant=checkInvariants(state);if(invariant)throw Error(invariant);
          const move=chooseComputerMove(state,random);
          const result=applyAction(state,move);if(!result.ok)throw Error(result.reason);
        }
        if(state.phase==='playing')throw Error('Deal did not terminate within the card budget.');
        const invariant=checkInvariants(state);if(invariant)throw Error(invariant);
        if(state.result.points.every(p=>p.total===0))zeroScore++;
        completed++;
      }catch(error){failures.push({seed:start,reason:String(error.message||error),state:state?JSON.parse(JSON.stringify(state)):null});}
    }
    return {tested:count,completed,zeroScore,failures,validation};
  }
  return { SUITS, DEFAULT_RULES, PRESETS, PRESET_CATALOG, DIFFICULTY_INFO, scoreCategories, allCards, cardKey, initialCardValues, standardCardValues, rulesFor, normalizeRules, validateRules, checkInvariants, simulateRules, cardValues, makeDeck, makeState, newMatch,
    cardName, cardValue, cardsInElement, findPartition, validateAction,
    legalBuildOptions, contextualBuildOptions, legalActions, applyAction, scoreHand, finishHand, nextHand,
    captureChoices, buildChoices, allComputerMoves, chooseComputerMove, hintSelections,
    explainMove, moveScore, buildActionLabel, publicPosition, samplePublicPosition, quickLegalMove, analyzeComputerMove, strategicValue };
});
