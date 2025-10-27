// ===== Card Tracker + Player Boxes + EV engine =====

// --- COSTANTI E HELPERS ---
const cardValues = ["A","2","3","4","5","6","7","8","9","10","J","Q","K"];
const hiLoValues = {"2":1,"3":1,"4":1,"5":1,"6":1,"7":0,"8":0,"9":0,"10":-1,"J":-1,"Q":-1,"K":-1,"A":-1};
const FACE_SET = ["J","Q","K"];
const TEN_VALUES = ["10","J","Q","K"];

function cloneDeck(d){ return Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v])); }
function deckTotal(d){ return Object.values(d).reduce((a,b)=>a+b,0); }
function deckKey(d){ return Object.entries(d).map(([k,v])=>k+v).join("|"); }
function handKey(cards){ return cards.join(","); }
function getCardNumericForTotal(c){ if (c==="A") return 11; if(TEN_VALUES.includes(c)) return 10; return parseInt(c); }
function getCardBaseValue(c){ if (c==="A") return 1; if (TEN_VALUES.includes(c)) return 10; return parseInt(c); }

// --- STATO GLOBALE ---
let numDecks = 8;
let totalCards = 52 * numDecks;
let remainingCards = totalCards;
let runningCount = 0;
let drawnCards = []; // storico tutte carte inserite in ordine
let deckState = {};  // { "A":n, "2":n, ... "K":n }

let boxes = Array.from({length:7},(_,i)=>({
  id: i+1,
  active: false,
  owner: false,
  cards: [],
  suggestion: null,
  tick: false
}));
let dealerCard = null;

let initialDistributionComplete = false;
let nextInitialRecipientIndex = 0; // indice nella sequenza recipientSeq
let recipientSeq = []; // costruita quando apri round: [0,1,..,N-1,'DEALER']

let nextCardBoxId = null; // id box che aspetta la prossima carta (aggiorna manuale)

// --- DOM ELEMENTS ---
const deckInput = document.getElementById("numDecks");
const totalCardsEl = document.getElementById("total-cards");
const remainingEl = document.getElementById("remaining-cards");
const runningCountEl = document.getElementById("running-count");
const trueCountEl = document.getElementById("true-count");
const lastCardEl = document.getElementById("last-card");
const highCardsEl = document.getElementById("high-cards");
const lowCardsEl = document.getElementById("low-cards");
const tableBody = document.querySelector("table tbody");
const cardInput = document.getElementById("card-input");
const addBtn = document.getElementById("add-card");
const gridButtons = document.querySelectorAll(".grid button");
const undoBtn = document.getElementById("undo");
const resetBtn = document.getElementById("reset");
const saveBtn = document.getElementById("save");
const activePlayersInput = document.getElementById("active-players");
const dealerCardEl = document.getElementById("dealer-card");
const playerBoxes = Array.from(document.querySelectorAll(".player-box"));
const closeRoundBtn = document.getElementById("close-round");

// --- INITIALIZZAZIONE DECK STATE ---
function initDeck(){
  numDecks = parseInt(deckInput.value) || 8;
  totalCards = 52 * numDecks;
  remainingCards = totalCards;
  runningCount = 0;
  drawnCards = [];
  deckState = {};
  cardValues.forEach(c => deckState[c] = 4 * numDecks);

  boxes.forEach(b => { b.cards = []; b.suggestion = null; b.tick = false; b.active = false; b.owner = false; });
  dealerCard = null;
  initialDistributionComplete = false;
  nextInitialRecipientIndex = 0;
  buildRecipientSeq();

  // apri round automaticamente
  const activeCount = parseInt(activePlayersInput.value) || 5;
  boxes.forEach((b,idx)=> b.active = idx < activeCount);

  updateUI();
  updateRightSide();
}

// --- CREA SEQUENZA DI DISTRIBUZIONE (players 1..N, DEALER) ---
function buildRecipientSeq(){
  const activeCount = parseInt(activePlayersInput.value) || 5;
  recipientSeq = [];
  for (let i=0;i<activeCount;i++) recipientSeq.push(i); // indices players
  recipientSeq.push("DEALER");
  nextInitialRecipientIndex = 0;
}

// --- UPDATE UI SINISTRA ---
function updateUI(){
  totalCardsEl.textContent = totalCards;
  remainingEl.textContent = remainingCards;
  runningCountEl.textContent = runningCount > 0 ? `+${runningCount}` : runningCount;

  let decksRemaining = remainingCards / 52;
  let trueCount = decksRemaining > 0 ? (runningCount / decksRemaining) : 0;
  const trueCountDisplay = Math.abs(trueCount) >= 100 ? trueCount.toFixed(2) : (trueCount >= 0 ? `+${trueCount.toFixed(2)}` : trueCount.toFixed(2));
  trueCountEl.textContent = trueCountDisplay;

  // colorazione trueCount
  if (trueCount < -2) { trueCountEl.style.backgroundColor = "#7f1d1d"; trueCountEl.style.color = "#fecaca"; }
  else if (trueCount > 2) { trueCountEl.style.backgroundColor = "#14532d"; trueCountEl.style.color = "#bbf7d0"; }
  else { trueCountEl.style.backgroundColor = "#78350f"; trueCountEl.style.color = "#fef3c7"; }

  // tabella stato mazzo
  tableBody.innerHTML = "";
  cardValues.forEach(card => {
    const tr = document.createElement("tr");
    const effect = hiLoValues[card] ?? 0;
    const remaining = deckState[card];
    const maxForCard = 4 * numDecks;
    const percentage = (remaining / maxForCard) * 100;

    let rowColor = "";
    if (remaining === 0) rowColor = "#7f1d1d";
    else if (percentage <= 25) rowColor = "#78350f";
    else if (percentage >= 75) rowColor = "#14532d";
    else rowColor = "#1e293b";

    tr.style.backgroundColor = rowColor;
    tr.innerHTML = `<td>${card}</td><td>${remaining}</td><td>${effect>0? "+"+effect : effect}</td>`;
    tableBody.appendChild(tr);
  });

  // high/low counts
  const high = deckState["10"] + deckState["J"] + deckState["Q"] + deckState["K"] + deckState["A"];
  const low = deckState["2"] + deckState["3"] + deckState["4"] + deckState["5"] + deckState["6"];
  highCardsEl.textContent = high;
  lowCardsEl.textContent = low;
}

// --- UPDATE COLONNA DESTRA ---
function updateRightSide(){
  dealerCardEl.textContent = dealerCard || "—";
  boxes.forEach((b,idx)=>{
    const boxEl = playerBoxes[idx];
    boxEl.querySelector(".card-display").textContent = b.cards.length ? b.cards.join(", ") : "—";
    boxEl.querySelector(".suggestion").textContent = b.suggestion || "—";
    boxEl.classList.toggle("active", b.active);
    boxEl.classList.toggle("owner", b.owner);
    const cb = boxEl.querySelector(".owner-check");
    if(cb) cb.checked = b.owner;
  });
}

// === AGGIUNGI CARTA (dalla UI) ===
function addCard(value){
  value = value.toUpperCase();
  if (!cardValues.includes(value)) return alert("Carta non valida!");
  if (deckState[value] <= 0) return alert("Tutte le carte di questo valore sono già uscite!");

  deckState[value]--;
  remainingCards--;
  runningCount += hiLoValues[value] ?? 0;
  drawnCards.push(value);
  lastCardEl.textContent = value;

  // se c'è un box che aspetta la carta (aggiorna manuale)
  if (nextCardBoxId) {
    const box = boxes[nextCardBoxId - 1];
    box.cards.push(value);
    // calcola suggerimento tramite motore EV
    const res = computeSuggestionForBox(nextCardBoxId - 1);
    if (res) box.suggestion = res.action;
    nextCardBoxId = null;
  }
  // altrimenti se la distribuzione iniziale non è completa, assegna in ordine
  else if (!initialDistributionComplete) {
    assignNextInitialCard(value);
  }
  // altrimenti carta rimane registrata (conteggi aggiornati) ma non assegnata

  updateUI();
  updateRightSide();
}

// === assegna NEXT initial card seguendo sequenza cyclic player..dealer .. player.. fino a completamento ===
function assignNextInitialCard(card) {
  // build recipientSeq se mancante
  if (!recipientSeq || recipientSeq.length === 0) buildRecipientSeq();
  const activeCount = recipientSeq.length - 1; // last is DEALER

  // We try to assign to next recipient that still needs cards.
  let attempts = 0;
  while (attempts < recipientSeq.length) {
    const recipient = recipientSeq[nextInitialRecipientIndex];
    nextInitialRecipientIndex = (nextInitialRecipientIndex + 1) % recipientSeq.length;
    attempts++;

    if (recipient === "DEALER") {
      if (!dealerCard) {
        dealerCard = card;
        // after assigning dealer we check complete
        checkInitialDistributionComplete();
        return;
      } else {
        // dealer already has a card; continue searching
        continue;
      }
    } else {
      // recipient is player index
      const b = boxes[recipient];
      if (!b.active) continue;
      if (b.cards.length < 2) {
        b.cards.push(card);
        // if owner, compute suggestion immediately for that box
        if (b.owner) {
          const res = computeSuggestionForBox(recipient);
          if (res) b.suggestion = res.action;
        }
        checkInitialDistributionComplete();
        return;
      } else {
        continue;
      }
    }
  }
  // se arriviamo qui, forse tutte complete: set flag
  checkInitialDistributionComplete();
}

// === check se tutte le initial cards sono state assegnate ===
function checkInitialDistributionComplete(){
  const activeBoxes = boxes.filter(b=>b.active);
  const allBoxesTwo = activeBoxes.every(b => b.cards.length >= 2);
  if (allBoxesTwo && dealerCard) {
    initialDistributionComplete = true;
    // quando completate, calcola suggerimenti per tutti i box owner
    activeBoxes.forEach((b, idx) => {
      if (b.owner) {
        const i = boxes.indexOf(b);
        const res = computeSuggestionForBox(i);
        if (res) b.suggestion = res.action;
      }
    });
    updateRightSide();
  }
}

// === CLOSE ROUND ===
function closeRound(){
  boxes.forEach(b => { b.cards = []; b.suggestion = null; b.tick = false; });
  dealerCard = null;
  initialDistributionComplete = false;
  nextInitialRecipientIndex = 0;
  buildRecipientSeq();
  // riapri round con active count
  const activeCount = parseInt(activePlayersInput.value) || 5;
  boxes.forEach((b, idx) => b.active = idx < activeCount);
  updateRightSide();
}

// === UNDO ultima carta globale ===
function undoCard(){
  if (!drawnCards.length) return;
  const last = drawnCards.pop();
  // se last è stato assegnato a qualche box o dealer dobbiamo rimuoverlo anche da lì
  // rimuoviamo prima occorrenza in ordine: ultima assegnazione a box/dealer (più semplice: scan boxes/dealer in reverse)
  // Cerca nelle hands dall'ultima carta assegnata a primo (non perfetto ma pratico per uso manuale)
  let removed = false;
  // rimuovi da dealer se coincidente
  if (dealerCard === last) { dealerCard = null; removed = true; }
  // rimuovi dall'ultimo box che contiene quella carta (cerca reverse)
  if (!removed) {
    for (let i=boxes.length-1;i>=0;i--){
      const idx = boxes[i].cards.lastIndexOf(last);
      if (idx !== -1) { boxes[i].cards.splice(idx,1); removed = true; break; }
    }
  }
  // aggiorna deckState e counts
  deckState[last] = (deckState[last]||0) + 1;
  remainingCards++;
  runningCount -= hiLoValues[last] || 0;
  lastCardEl.textContent = drawnCards.at(-1) || "—";
  // reset initialDistributionComplete if needed
  if (initialDistributionComplete) initialDistributionComplete = false;
  updateUI();
  updateRightSide();
}

// === SAVE / LOAD state ===
function saveState(){
  const state = {
    numDecks, totalCards, remainingCards, runningCount, deckState, drawnCards, boxes, dealerCard,
    initialDistributionComplete
  };
  localStorage.setItem("cardTrackerState", JSON.stringify(state));
  alert("Stato salvato ✅");
}
function loadState(){
  const saved = localStorage.getItem("cardTrackerState");
  if (!saved) return initDeck();
  try {
    const state = JSON.parse(saved);
    numDecks = state.numDecks || 8;
    totalCards = state.totalCards || 52 * numDecks;
    remainingCards = state.remainingCards || totalCards;
    runningCount = state.runningCount || 0;
    deckState = state.deckState || deckState;
    drawnCards = state.drawnCards || [];
    boxes = state.boxes || boxes;
    dealerCard = state.dealerCard || null;
    initialDistributionComplete = state.initialDistributionComplete || false;
    deckInput.value = numDecks;
    buildRecipientSeq();
    updateUI();
    updateRightSide();
    lastCardEl.textContent = drawnCards.at(-1) || "—";
  } catch (e) {
    console.error("Errore loading state:", e);
    initDeck();
  }
}

// =================== EV ENGINE (dealer distribution + evaluateBestAction) ===================

// dealerFinalProbabilities: returns map {17:prob,18:prob,19:prob,20:prob,21:prob,bust:prob}
const dealerFinalCache = new Map();
function dealerFinalProbabilities(deckStateArg, dealerUpcard) {
  const key = deckKey(deckStateArg) + "::UP=" + dealerUpcard;
  if (dealerFinalCache.has(key)) return dealerFinalCache.get(key);

  const deck = cloneDeck(deckStateArg);
  // remove upcard if present
  if (deck[dealerUpcard] && deck[dealerUpcard] > 0) deck[dealerUpcard]--;

  const initVal = (dealerUpcard==="A")?11:(TEN_VALUES.includes(dealerUpcard)?10:parseInt(dealerUpcard));
  const initUsable = (dealerUpcard==="A")?1:0;

  const memo = new Map();

  function recurse(total, usableAces, deckLocal) {
    const mkey = total + "|" + usableAces + "|" + deckKey(deckLocal);
    if (memo.has(mkey)) return memo.get(mkey);
    if (total >= 17) {
      const res = {};
      if (total > 21) res.bust = 1;
      else res[total] = 1;
      memo.set(mkey, res);
      return res;
    }
    const totalCardsLeft = deckTotal(deckLocal);
    if (totalCardsLeft === 0) {
      const res = {};
      if (total > 21) res.bust = 1;
      else res[total] = 1;
      memo.set(mkey, res);
      return res;
    }
    const agg = {};
    for (const card of Object.keys(deckLocal)) {
      const count = deckLocal[card];
      if (count <= 0) continue;
      const prob = count / totalCardsLeft;
      deckLocal[card]--;
      let add = (card==="A")?11:(TEN_VALUES.includes(card)?10:parseInt(card));
      let newTotal = total + add;
      let newUsable = usableAces + (card==="A"?1:0);
      while (newTotal > 21 && newUsable > 0) { newTotal -= 10; newUsable--; }
      const sub = recurse(newTotal, newUsable, deckLocal);
      for (const k in sub) agg[k] = (agg[k]||0) + prob * sub[k];
      deckLocal[card]++;
    }
    memo.set(mkey, agg);
    return agg;
  }

  const finalDist = recurse(initVal, initUsable, deck);
  dealerFinalCache.set(key, finalDist);
  return finalDist;
}

// stand EV using dealer distribution
function standEV(playerTotal, dealerDist) {
  let ev = 0;
  for (const k in dealerDist) {
    const p = dealerDist[k];
    if (k === "bust") { ev += p * 1; continue; }
    const dTotal = parseInt(k);
    if (dTotal > 21) ev += p * 1;
    else if (dTotal < playerTotal) ev += p * 1;
    else if (dTotal === playerTotal) ev += p * 0;
    else ev += p * -1;
  }
  return ev;
}

// recursive evaluator (memoized)
const EVAL_CACHE = new Map();

function evaluateBestAction(playerCards, deckStateArg, dealerUpcard, canDouble=true, canSplit=true, afterSplit=false) {
  const key = [handKey(playerCards), deckKey(deckStateArg), dealerUpcard, canDouble?1:0, canSplit?1:0, afterSplit?1:0].join("||");
  if (EVAL_CACHE.has(key)) return EVAL_CACHE.get(key);

  // compute player's total with aces
  let total = 0, aces = 0;
  for (const c of playerCards) {
    if (c === "A") { total += 11; aces++; }
    else if (TEN_VALUES.includes(c)) total += 10;
    else total += parseInt(c);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  if (total > 21) {
    const r = { ev: -1, action: "Bust" };
    EVAL_CACHE.set(key, r); return r;
  }

  // compute dealer distribution
  const dealerDist = dealerFinalProbabilities(deckStateArg, dealerUpcard);

  // Stand EV
  const stand_ev = standEV(total, dealerDist);

  // Double EV (draw one then stand) - payoff *2
  let double_ev = -Infinity;
  if (canDouble && !afterSplit) {
    const tot = deckTotal(deckStateArg);
    if (tot > 0) {
      let acc = 0;
      for (const card of Object.keys(deckStateArg)) {
        const cnt = deckStateArg[card];
        if (cnt <= 0) continue;
        const prob = cnt / tot;
        deckStateArg[card]--;
        // calc new total after draw
        let nv = 0, na = 0;
        for (const cc of playerCards) {
          if (cc==="A"){ nv+=11; na++; }
          else if (TEN_VALUES.includes(cc)) nv+=10;
          else nv+=parseInt(cc);
        }
        // include new card cc
        if (card==="A"){ nv+=11; na++; } else if (TEN_VALUES.includes(card)) nv+=10; else nv+=parseInt(card);
        while (nv>21 && na>0){ nv-=10; na--; }
        const sub = standEV(nv, dealerDist);
        deckStateArg[card]++;
        acc += prob * sub;
      }
      double_ev = 2 * acc;
    }
  }

  // Hit EV (draw one, then make best decision)
  let hit_ev = -Infinity;
  {
    const tot = deckTotal(deckStateArg);
    if (tot > 0) {
      let acc = 0;
      for (const card of Object.keys(deckStateArg)) {
        const cnt = deckStateArg[card];
        if (cnt <= 0) continue;
        const prob = cnt / tot;
        deckStateArg[card]--;
        const newHand = playerCards.concat([card]);
        // We disallow doubling after a hit in recursion (common simplification)
        const sub = evaluateBestAction(newHand, deckStateArg, dealerUpcard, false, false, afterSplit);
        deckStateArg[card]++;
        acc += prob * sub.ev;
      }
      hit_ev = acc;
    }
  }

  // Split EV (if pair and allowed)
  let split_ev = -Infinity;
  if (canSplit && playerCards.length === 2) {
    const a = playerCards[0], b = playerCards[1];
    const valA = (a==="A")?11:(TEN_VALUES.includes(a)?10:parseInt(a));
    const valB = (b==="A")?11:(TEN_VALUES.includes(b)?10:parseInt(b));
    const isPair = (valA === valB) || (TEN_VALUES.includes(a) && TEN_VALUES.includes(b));
    if (isPair) {
      const tot = deckTotal(deckStateArg);
      if (tot > 1) {
        let acc = 0;
        // approximate by drawing independently for the two split hands
        for (const card1 of Object.keys(deckStateArg)) {
          const cnt1 = deckStateArg[card1]; if (cnt1 <= 0) continue;
          const p1 = cnt1 / tot;
          deckStateArg[card1]--;
          for (const card2 of Object.keys(deckStateArg)) {
            const cnt2 = deckStateArg[card2]; if (cnt2 <= 0) continue;
            const p2 = cnt2 / (tot-1);
            const ev1 = evaluateBestAction([playerCards[0], card1], deckStateArg, dealerUpcard, false, false, true).ev;
            const ev2 = evaluateBestAction([playerCards[1], card2], deckStateArg, dealerUpcard, false, false, true).ev;
            acc += p1 * p2 * ((ev1 + ev2) / 2);
          }
          deckStateArg[card1]++;
        }
        split_ev = acc;
      }
    }
  }

  // choose best option
  const opts = [{action:"Stand", ev:stand_ev}, {action:"Hit", ev:hit_ev}];
  if (double_ev !== -Infinity) opts.push({action:"Double", ev:double_ev});
  if (split_ev !== -Infinity) opts.push({action:"Split", ev:split_ev});

  let best = opts[0];
  for (const o of opts) if (o.ev > best.ev) best = o;

  const result = { ev: best.ev, action: best.action };
  EVAL_CACHE.set(key, result);
  return result;
}

// === API helper: computeSuggestionForBox(boxIndex) ===
function computeSuggestionForBox(boxIndex) {
  const box = boxes[boxIndex];
  if (!box || !box.active) return null;
  // recompute true count
  const decksRemaining = remainingCards / 52;
  const tc = decksRemaining > 0 ? runningCount / decksRemaining : 0;
  // clone deck for safety
  const deckClone = cloneDeck(deckState);
  const res = evaluateBestAction(box.cards.slice(), deckClone, dealerCard, true, true, false);
  return { action: res.action, ev: res.ev, trueCount: tc };
}

// =================== EVENT LISTENERS ===================

// player boxes controls
playerBoxes.forEach((boxEl, idx) => {
  const updateBtn = boxEl.querySelector(".update-suggestion");
  updateBtn.addEventListener("click", () => {
    // set nextCardBoxId: the next card clicked will be assigned here
    nextCardBoxId = idx + 1;
    // visual feedback: temporary highlight (optional)
    boxEl.classList.add("waiting-card");
    setTimeout(()=>boxEl.classList.remove("waiting-card"), 4000);
  });
  const cb = boxEl.querySelector(".owner-check");
  cb.addEventListener("change", e => { boxes[idx].owner = e.target.checked; updateRightSide(); });
});

// left controls
addBtn.addEventListener("click", ()=>{ const val = cardInput.value.trim(); if(val){ addCard(val); cardInput.value = ""; }});
cardInput.addEventListener("keypress", e=>{ if (e.key === "Enter") addBtn.click(); });
gridButtons.forEach(btn => btn.addEventListener("click", ()=> addCard(btn.textContent)));
undoBtn.addEventListener("click", ()=> undoCard());
resetBtn.addEventListener("click", ()=> { if(confirm("Vuoi resettare la partita?")) initDeck(); });
saveBtn.addEventListener("click", saveState);
deckInput.addEventListener("change", ()=> { initDeck(); });
activePlayersInput.addEventListener("change", ()=> { buildRecipientSeq(); initRoundActivePlayers(); });

// close round
closeRoundBtn.addEventListener("click", closeRound);

// helper to set active players when activePlayersInput changes without wiping deck counts
function initRoundActivePlayers(){
  const activeCount = parseInt(activePlayersInput.value) || 5;
  boxes.forEach((b, idx) => { b.active = idx < activeCount; b.cards = []; b.suggestion = null; b.tick = false; });
  dealerCard = null;
  initialDistributionComplete = false;
  nextInitialRecipientIndex = 0;
  buildRecipientSeq();
  updateRightSide();
}

// --- LOAD/START ---
loadState();

// if no saved state, ensure deck initialized
function loadState(){
  const saved = localStorage.getItem("cardTrackerState");
  if (!saved) { initDeck(); return; }
  try {
    const state = JSON.parse(saved);
    numDecks = state.numDecks || 8;
    totalCards = state.totalCards || 52 * numDecks;
    remainingCards = state.remainingCards || totalCards;
    runningCount = state.runningCount || 0;
    deckState = state.deckState || deckState;
    drawnCards = state.drawnCards || [];
    boxes = state.boxes || boxes;
    dealerCard = state.dealerCard || null;
    initialDistributionComplete = state.initialDistributionComplete || false;
    deckInput.value = numDecks;
    buildRecipientSeq();
    updateUI();
    updateRightSide();
    lastCardEl.textContent = drawnCards.at(-1) || "—";
  } catch (e) {
    console.error("Load error", e);
    initDeck();
  }
}
