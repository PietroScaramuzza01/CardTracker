window.addEventListener("load", () => {
  // Cancella eventuali salvataggi automatici
  localStorage.removeItem("cardTrackerState");

  // Reinizializza tutto
  if (typeof resetGame === "function") resetGame();
  console.log("🔄 Stato azzerato all'avvio");
});

// ===== Card Tracker + Player Boxes + EV engine =====
const Versione = "J.V. 0.3";
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
// storico delle assegnazioni per gestire undo correttamente
let assignmentHistory = []; // elementi: { card: "10", recipient: idx | "DEALER", phase: "initial"|"manual" }

let boxes = Array.from({length:7},(_,i)=>({
  id: i+1,
  active: false,
  owner: false,
  cards: [],
  suggestion: null,
  tick: false
}));
let dealerCard=null;

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
// NOTE: exclude #undo from gridButtons to avoid accidental calls
const gridButtons = document.querySelectorAll(".grid button:not(#undo)");
const undoBtn = document.getElementById("undo");
const resetBtn = document.getElementById("reset");
const saveBtn = document.getElementById("save");

const playerBoxes = Array.from(document.querySelectorAll(".player-box"));
const closeRoundBtn = document.getElementById("close-round");

// We'll dynamically add export/import buttons next to saveBtn
let exportBtn, importBtn, importFileInput;
function createExportImportUI() {
  if (!saveBtn) return;
  const container = saveBtn.parentElement || saveBtn;
  // avoid duplicate creation
  if (document.getElementById("export-state")) return;

  exportBtn = document.createElement("button");
  exportBtn.id = "export-state";
  exportBtn.textContent = "Esporta JSON";
  exportBtn.style.marginLeft = "8px";
  saveBtn.insertAdjacentElement("afterend", exportBtn);

  importBtn = document.createElement("button");
  importBtn.id = "import-state";
  importBtn.textContent = "Importa JSON";
  importBtn.style.marginLeft = "8px";
  exportBtn.insertAdjacentElement("afterend", importBtn);

  importFileInput = document.createElement("input");
  importFileInput.type = "file";
  importFileInput.accept = "application/json";
  importFileInput.style.display = "none";
  document.body.appendChild(importFileInput);

  exportBtn.addEventListener("click", exportState);
  importBtn.addEventListener("click", ()=> importFileInput.click());
  importFileInput.addEventListener("change", (e)=> {
    if (e.target.files && e.target.files[0]) importStateFile(e.target.files[0]);
    importFileInput.value = ""; // reset
  });
}



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

  updateUI();
  updateDealerCard();
  updateRightSide();
}
// --- CREA SEQUENZA DI DISTRIBUZIONE (players 1..N, DEALER) ---
function buildRecipientSeq(){
  recipientSeq = boxes.map((b,i) => b.active ? i : null).filter(i => i !== null);
  recipientSeq.push("DEALER");
  nextInitialRecipientIndex = 0;
}

// --- UPDATE UI SINISTRA ---
function updateUI() {
  totalCardsEl.textContent = totalCards;
  remainingEl.textContent = remainingCards;
  runningCountEl.textContent = runningCount>0?`+${runningCount}`:runningCount;

  let decksRemaining = remainingCards/52;
  let trueCount = decksRemaining>0?(runningCount/decksRemaining).toFixed(2):0;
  trueCountEl.textContent = trueCount>=0?`+${trueCount}`:trueCount;

  // colore true count
  if(trueCount<-2){trueCountEl.style.backgroundColor="#7f1d1d"; trueCountEl.style.color="#fecaca";}
  else if(trueCount>2){trueCountEl.style.backgroundColor="#14532d"; trueCountEl.style.color="#bbf7d0";}
  else{trueCountEl.style.backgroundColor="#78350f"; trueCountEl.style.color="#fef3c7";}

  // tabella
  tableBody.innerHTML="";
  cardValues.forEach(card=>{
    const tr=document.createElement("tr");
    const effect=hiLoValues[card]||0;
    const remaining=deckState[card];
    const maxForCard=4*numDecks;
    const percentage=(remaining/maxForCard)*100;
    let rowColor="";
    if(remaining===0) rowColor="#7f1d1d";
    else if(percentage<=25) rowColor="#78350f";
    else if(percentage>=75) rowColor="#14532d";
    else rowColor="#1e293b";
    tr.style.backgroundColor=rowColor;
    tr.innerHTML=`<td>${card}</td><td>${remaining}</td><td>${effect>0?"+"+effect:effect}</td>`;
    tableBody.appendChild(tr);
  });

  // high/low counts (safe guard if deckState not ready)
  const high = (deckState["10"]||0) + (deckState["J"]||0) + (deckState["Q"]||0) + (deckState["K"]||0) + (deckState["A"]||0);
  const low = (deckState["2"]||0) + (deckState["3"]||0) + (deckState["4"]||0) + (deckState["5"]||0) + (deckState["6"]||0);
  highCardsEl.textContent = high;
  lowCardsEl.textContent = low;
}
function updateDealerCard() {
  const dealerCardEl = document.querySelector("#dealer-card");
  if (!dealerCardEl) return;

  // 🔧 Usa la variabile GLOBALE, non crearne una nuova locale!
  if (dealerCard && dealerCard !== "—") {
    dealerCardEl.textContent = dealerCard;
  } else {
    dealerCardEl.textContent = "—";
    console.warn("dealerCard non definito, ma aggiorno comunque le box");
  }
}

// --- AGGIORNA DESTRA ---
function updateRightSide() {


 
  boxes.forEach((b, idx) => {
    const boxEl = playerBoxes[idx];
    if (!boxEl) return;

    // aggiorna visualizzazione carte
    const cardDisplay = boxEl.querySelector(".card-display");
    if (cardDisplay) cardDisplay.textContent = b.cards.length ? b.cards.join(", ") : "—";

    // aggiorna suggerimento senza sovrascrivere il contenitore
    const suggestionEl = boxEl.querySelector(".suggestion");
    if (suggestionEl) {
      // assicurati che ci siano gli span
      let actionEl = suggestionEl.querySelector('.action');
      if (!actionEl) {
        actionEl = document.createElement('span');
        actionEl.className = 'action';
        suggestionEl.appendChild(actionEl);
      }

      let hitEl = suggestionEl.querySelector('.hit-percent');
      if (!hitEl) {
        hitEl = document.createElement('span');
        hitEl.className = 'hit-percent';
        hitEl.style.marginLeft = '6px';
        suggestionEl.appendChild(hitEl);
      }

      let standEl = suggestionEl.querySelector('.stand-percent');
      if (!standEl) {
        standEl = document.createElement('span');
        standEl.className = 'stand-percent';
        standEl.style.marginLeft = '6px';
        suggestionEl.appendChild(standEl);
      }

      let doubleEl = suggestionEl.querySelector('.double-percent');
      if (!doubleEl) {
        doubleEl = document.createElement('span');
        doubleEl.className = 'double-percent';
        doubleEl.style.marginLeft = '6px';
        suggestionEl.appendChild(doubleEl);
      }

      let splitEl = suggestionEl.querySelector('.split-percent');
      if (!splitEl) {
        splitEl = document.createElement('span');
        splitEl.className = 'split-percent';
        splitEl.style.marginLeft = '6px';
        suggestionEl.appendChild(splitEl);
      }

      // aggiorna contenuti
      actionEl.textContent = b.suggestion?.action || "—";
      hitEl.textContent = b.suggestion?.hit != null ? `Hit: ${b.suggestion.hit}%` : "";
      standEl.textContent = b.suggestion?.stand != null ? `Stand: ${b.suggestion.stand}%` : "";
      doubleEl.textContent = b.suggestion?.double != null ? `Double: ${b.suggestion.double}%` : "";
      splitEl.textContent = b.suggestion?.split != null ? `Split: ${b.suggestion.split}%` : "";
   splitEl.textContent =
  typeof b.suggestion?.split === "string" || typeof b.suggestion?.split === "number"
    ? `Split: ${b.suggestion.split}%`
    : "";

    }

    // aggiorna classi box
    boxEl.classList.toggle("active", b.active);
    boxEl.classList.toggle("owner", b.owner);

    const ownerCb = boxEl.querySelector(".owner-check");
    if (ownerCb) ownerCb.checked = !!b.owner;
  });
}


// --- AGGIUNGI CARTA ---
function addCard(value) {
  if (!value || typeof value !== "string") return;
  value = value.toUpperCase();
  if (!cardValues.includes(value)) { showMessage("Carta non valida!"); return; }
  if (!deckState[value] || deckState[value] <= 0) { showMessage("Tutte le carte di questo valore sono già uscite!"); return; }

  deckState[value]--;
  remainingCards--;
  runningCount += hiLoValues[value] || 0;
  drawnCards.push(value);
  lastCardEl.textContent = value;

  if (!initialDistributionComplete) {
    assignNextInitialCard(value);
  } else if (nextCardBoxId) {
    const box = boxes[nextCardBoxId - 1];
    box.cards.push(value);

    // registra assegnazione per Undo
    assignmentHistory.push({ card: value, recipient: nextCardBoxId - 1, phase: "manual" });

    // Calcola suggerimento
    const suggestionResult = computeSuggestionForBox(nextCardBoxId - 1) || {};
    box.suggestion = suggestionResult?.action || "—";

    // LOG su console (safe formatting)
    console.log(`Box ${nextCardBoxId} - Carte: [${box.cards.join(", ")}], Suggerimento: ${box.suggestion}, EV: ${typeof suggestionResult.ev === 'number' ? suggestionResult.ev.toFixed(3) : suggestionResult.ev}, True Count: ${typeof suggestionResult.trueCount === 'number' ? suggestionResult.trueCount.toFixed(2) : suggestionResult.trueCount}`);

    nextCardBoxId = null;
  }


  updateUI();
  updateDealerCard();
  updateRightSide();
}
// === assegna NEXT initial card seguendo sequenza cyclic player..dealer .. player.. fino a completamento ===
// funzione che assegna automaticamente le carte iniziali nell'ordine corretto
function assignNextInitialCard(card) {
  const activeBoxes = boxes.filter(b => b.active);

  for (let b of activeBoxes) {
    if (b.cards.length === 0) {
      b.cards.push(card);
      const idx = boxes.indexOf(b);
      assignmentHistory.push({ card, recipient: idx, phase: "initial" });
      if (b.owner) {
        const suggestionResult = computeSuggestionForBox(idx) || {};
        b.suggestion = suggestionResult.action || "—";
        console.log(`Box ${idx + 1} (Initial) - Carte: [${b.cards.join(", ")}], Suggerimento: ${b.suggestion}`);
      }
      checkInitialDistributionComplete();
      updateRightSide(); // ✅ AGGIUNTA QUI
      return;
    }
  }

  if (!dealerCard) {
    dealerCard = card;
    assignmentHistory.push({ card, recipient: "DEALER", phase: "initial" });
    checkInitialDistributionComplete();
    updateDealerCard();
    updateRightSide(); // ✅ AGGIUNTA QUI
    return;
  }

  for (let b of activeBoxes) {
    if (b.cards.length < 2) {
      b.cards.push(card);
      const idx = boxes.indexOf(b);
      assignmentHistory.push({ card, recipient: idx, phase: "initial" });
      if (b.owner) {
        const suggestionResult = computeSuggestionForBox(idx) || {};
        b.suggestion = suggestionResult.action || "—";
        console.log(`Box ${idx + 1} (Initial) - Carte: [${b.cards.join(", ")}], Suggerimento: ${b.suggestion}`);
      }
      checkInitialDistributionComplete();
      updateDealerCard();
      updateRightSide(); // ✅ AGGIUNTA QUI
      return;
    }
  }

  console.warn("assignNextInitialCard: no recipient found for", card);


}


function checkInitialDistributionComplete() {
  const activeBoxes = boxes.filter(b => b.active);
  const allBoxesHaveTwo = activeBoxes.every(b => b.cards.length >= 2);
  if (allBoxesHaveTwo && dealerCard) {
    initialDistributionComplete = true;
  }
}

// --- DISTRIBUZIONE INITIAL CARDS (utility) ---
function drawInitialCards() {
  const activeBoxes = boxes.filter(b=>b.active);
  if(!activeBoxes.length) return;
  let cardIndex=0;
  let dealerAssigned=false;

  while(cardIndex<drawnCards.length){
    for(let b of activeBoxes){
      if(cardIndex>=drawnCards.length) break;
      b.cards.push(drawnCards[cardIndex]);
      cardIndex++;
    }
    if(!dealerAssigned && cardIndex<drawnCards.length){
      dealerCard=drawnCards[cardIndex];
      cardIndex++;
      dealerAssigned=true;
    }
  }
}

// EV ENGINE and evaluateBestAction ... (unchanged)
// For brevity in this message I keep the EV engine code identical to your previous working version.
// Paste your existing dealerFinalProbabilities / standEV / evaluateBestAction / computeSuggestionForBox here.
// (Keep the same functions you already had — ensure they are present in the file)

/// --- placeholder: KEEP your existing EV engine and computeSuggestionForBox functions here ---
/// (Do not remove them; they are required. In the file you should include the full implementations.)

// function dealerFinalProbabilities(...) { ... }
// function standEV(...) { ... }
// function evaluateBestAction(...) { ... }
// function computeSuggestionForBox(...) { ... }

// --- UPDATE SUGGESTIONS helper ---
function updateAllSuggestions() {
  if (!dealerCard) return; // sicurezza
  boxes.forEach((b, idx) => {
    if (b.active && b.owner && b.cards.length > 0) {
      const res = computeSuggestionForBox(idx);
      b.suggestion = res?.action || "—";
    }
  });
  updateDealerCard();
  updateRightSide();
}

function closeRound(){
  boxes.forEach(b => { b.cards = []; b.suggestion = null; b.tick = false; });
  dealerCard = null;
  initialDistributionComplete = false;
  nextInitialRecipientIndex = 0;
  buildRecipientSeq();
  updateDealerCard();
  updateRightSide();
}

// --- UNDO ---
function undoCard(){
  // disable add button briefly to avoid race
  addBtn.disabled = true;
  if (!drawnCards.length) {
    showMessage("Nessuna carta da annullare");
    setTimeout(()=> addBtn.disabled = false, 50);
    return;
  }

  const last = drawnCards.pop();
  deckState[last] = (deckState[last] || 0) + 1;
  remainingCards++;
  runningCount -= hiLoValues[last] || 0;

  const lastAssign = assignmentHistory.pop();
  if (lastAssign) {
    if (lastAssign.recipient === "DEALER") {
      dealerCard = null;
    } else if (typeof lastAssign.recipient === "number") {
      const b = boxes[lastAssign.recipient];
      const idx = b.cards.lastIndexOf(last);
      if (idx !== -1) b.cards.splice(idx, 1);
    }
    if (lastAssign.phase === "initial") initialDistributionComplete = false;
  }

  // aggiorna l’ultimo valore visualizzato (safe)
  lastCardEl.textContent = drawnCards.length ? drawnCards[drawnCards.length-1] : "—";

  updateUI();
  updateDealerCard();
  updateRightSide();
  setTimeout(()=> addBtn.disabled = false, 50); // riattiva subito dopo
}

// --- SAVE / LOAD / EXPORT / IMPORT ---
function saveState(){
  const state = { numDecks, totalCards, remainingCards, runningCount, deckState, drawnCards, boxes, dealerCard, initialDistributionComplete };
  localStorage.setItem("cardTrackerState", JSON.stringify(state));
  showMessage("Stato salvato ✅");
}
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
    updateDealerCard();
    updateRightSide();
    lastCardEl.textContent = drawnCards.at(-1) || "—";
  } catch (e) {
    console.error("Load error", e);
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
  // 🔧 AGGIUNGI subito dopo il calcolo di "total" in evaluateBestAction()
const isSoft = (aces > 0 && total <= 21);
const canRealisticallyDouble =
  canDouble &&
  !afterSplit &&
  playerCards.length === 2 &&
  (
    // ✅ Double solo su 9, 10, 11 (hard)
    (!isSoft && total >= 9 && total <= 11)
    ||
    // ✅ Double su A,2..A,7 (soft 13–18)
    (isSoft && total >= 13 && total <= 18)
  );

  // Double EV (draw one then stand) - payoff *2
  let double_ev = -Infinity;
if (canRealisticallyDouble) {

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
      // calcola lo split più realistico in base alla distribuzione residua del mazzo
      for (const card1 of Object.keys(deckStateArg)) {
        const cnt1 = deckStateArg[card1];
        if (cnt1 <= 0) continue;
        const p1 = cnt1 / tot;
        deckStateArg[card1]--;

        for (const card2 of Object.keys(deckStateArg)) {
          const cnt2 = deckStateArg[card2];
          if (cnt2 <= 0) continue;
          const p2 = cnt2 / (tot - 1);

          // Calcolo EV per entrambe le mani dopo lo split
          const ev1 = evaluateBestAction([a, card1], deckStateArg, dealerUpcard, true, false, true).ev;
          const ev2 = evaluateBestAction([b, card2], deckStateArg, dealerUpcard, true, false, true).ev;

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

// === API helper: practicalSuggestion intelligente ===
function practicalSuggestion(evResult, tc, playerCards, dealerCard) {
  if (!evResult || !evResult.action || isNaN(evResult.ev)) return "—";

  const EV_THRESHOLD = 0.25; // soglia minima per considerare la mossa "decente"
  const HIGH_TC = 2.0;       // soglia conteggio alto
  const LOW_TC = -2.0;       // soglia conteggio basso

  const isSoft = playerCards.includes("A") && totalValue(playerCards) <= 21;

  // 1️⃣ EV troppo basso → non rischiare
  if (evResult.ev < EV_THRESHOLD) return "Follow Base";

  // 2️⃣ EV medio ma conteggio basso → comportamento prudente
  if (tc < LOW_TC && (evResult.action === "Double" || evResult.action === "Split")) {
    return "Follow Base";
  }

  // 3️⃣ EV buono e TC alto → enfatizza le mosse forti
  if (tc > HIGH_TC && evResult.ev > 0.5) {
    if (evResult.action === "Double" || evResult.action === "Split") {
      return "Strategy Override";
    }
  }

  // 4️⃣ Mani soft: prudenza se doppio borderline
  if (isSoft && evResult.action === "Double" && evResult.ev < 0.7) {
    return "Follow Base";
  }

  // 5️⃣ Default: restituisci l’azione
  return evResult.action;
}

// Helper: calcola il valore totale (con gestione Asso)
function totalValue(cards) {
  let total = 0, aces = 0;
  for (const c of cards) {
    if (c === "A") { total += 11; aces++; }
    else if (TEN_VALUES.includes(c)) total += 10;
    else total += parseInt(c);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

// === computeSuggestionForBox aggiornato ===
function computeSuggestionForBox(boxIndex) {
  const dealerCardEl = document.querySelector(`#player-${boxIndex} .dealer-card`);
  if (!dealerCardEl || dealerCardEl.textContent.trim() === "—") {
    console.warn(`computeSuggestionForBox: dealerCard non definito, skip calcolo per box ${boxIndex}`);
    return; // ✅ ok dentro funzione
  }

  const dealerCard = dealerCardEl.textContent.trim();

  const box = boxes[boxIndex];
  if (!box || !box.active || !box.owner) return null;

  if (!dealerCard || dealerCard === "—" || dealerCard === null) {
    console.warn(`computeSuggestionForBox: dealerCard non definito, skip calcolo per box ${boxIndex+1}`);
    return { action: "—", ev: 0, trueCount: 0 };
  }

  if (!box.cards || box.cards.length === 0) {
    return { action: "—", ev: 0, trueCount: 0 };
  }

  try {
    const decksRemaining = remainingCards / 52;
    const tc = decksRemaining > 0 ? runningCount / decksRemaining : 0;
    const deckClone = cloneDeck(deckState);

    const canDouble = box.cards.length === 2;
    const res = evaluateBestAction(box.cards.slice(), deckClone, dealerCard, canDouble, true, false);

    if (!res || !res.action || isNaN(res.ev)) {
      console.warn("computeSuggestionForBox: risultato non valido", res);
      return { action: "—", ev: 0, trueCount: tc };
    }

    // Applica il ragionamento strategico
    const smartAction = practicalSuggestion(res, tc, box.cards, dealerCard);

    return { action: smartAction, ev: res.ev, trueCount: tc };
  } catch (err) {
    console.error("computeSuggestionForBox: errore nel calcolo EV", err);
    return { action: "—", ev: 0, trueCount: 0 };
  }
}




// Export current state as JSON file
function exportState() {
  const state = { numDecks, totalCards, remainingCards, runningCount, deckState, drawnCards, boxes, dealerCard, initialDistributionComplete };
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const fname = `cardtracker-state-${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showMessage("Esportazione avviata ✅");
}

// Import state from a selected file (File object)
function importStateFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const state = JSON.parse(e.target.result);
      // Basic validation
      if (!state || typeof state !== 'object') throw new Error("File non valido");
      // Load
      numDecks = state.numDecks || numDecks;
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
      updateDealerCard();
      updateRightSide();
      lastCardEl.textContent = drawnCards.at(-1) || "—";
      showMessage("Importazione completata ✅");
    } catch (err) {
      console.error("Import error", err);
      showMessage("Errore importazione: file non valido");
    }
  };
  reader.readAsText(file);
}
// --- Eventi Download / Upload ---
const downloadBtn = document.getElementById("download-state");
const uploadInput = document.getElementById("upload-state");

if (downloadBtn) {
  downloadBtn.addEventListener("click", exportState);
}

if (uploadInput) {
  uploadInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    importStateFile(file);
  });
}


// --- UI helpers ---
function showMessage(msg) {
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = msg;
  // basic toast style inlined so it appears even without CSS
  div.style.position = "fixed";
  div.style.right = "16px";
  div.style.bottom = "16px";
  div.style.background = "rgba(0,0,0,0.8)";
  div.style.color = "white";
  div.style.padding = "8px 12px";
  div.style.borderRadius = "6px";
  div.style.zIndex = 9999;
  document.body.appendChild(div);
  setTimeout(()=>div.remove(), 1800);
}

// =================== EVENT LISTENERS ===================

// player boxes controls
playerBoxes.forEach((boxEl, idx) => {
  const ownerCb = boxEl.querySelector(".owner-check");
  if (ownerCb) {
    ownerCb.addEventListener("change", e => {
      boxes[idx].owner = e.target.checked;
      updateDealerCard();
      updateRightSide();
       // Log di conferma
      if (e.target.checked) {
        console.log(`Box ${idx + 1} è ora di tua proprietà ✅`);
      } else {
        console.log(`Box ${idx + 1} NON è più di tua proprietà ❌`);
      }
    });
  }

  const activeCb = boxEl.querySelector(".active-check");
  if (activeCb) {
    activeCb.addEventListener("change", e => {
      boxes[idx].active = e.target.checked;
      buildRecipientSeq(); // aggiorna sequenza distribuzione iniziale
      initialDistributionComplete = false;
      updateDealerCard();
      updateRightSide();
       // Log di conferma
      if (e.target.checked) {
        console.log(`Box ${idx + 1} è ora ATTIVO ✅`);
      } else {
        console.log(`Box ${idx + 1} NON è più ATTIVO ❌`);
      }
    });
  }

  const updateBtn = boxEl.querySelector(".update-suggestion");
  if (updateBtn) {
    updateBtn.addEventListener("click", () => {
      nextCardBoxId = idx + 1; // manda la prossima carta a questo box
      boxEl.classList.add("waiting-card");
      setTimeout(()=>boxEl.classList.remove("waiting-card"), 4000);
    });
  }
});
function undoCard(){
  addBtn.disabled = true;
  if (!drawnCards.length) return showMessage("Nessuna carta da annullare");

  const last = drawnCards.pop();
  deckState[last] = (deckState[last] || 0) + 1;
  remainingCards++;
  runningCount -= hiLoValues[last] || 0;

  const lastAssign = assignmentHistory.pop();
  if (lastAssign) {
    if (lastAssign.recipient === "DEALER") {
      dealerCard = null;
    } else if (typeof lastAssign.recipient === "number") {
      const b = boxes[lastAssign.recipient];
      const idx = b.cards.lastIndexOf(last);
      if (idx !== -1) b.cards.splice(idx, 1);
    }
    if (lastAssign.phase === "initial") initialDistributionComplete = false;
  }

  // Aggiorna input per prevenire alert
  cardInput.value = "";

  // aggiorna l’ultimo valore visualizzato
  lastCardEl.textContent = drawnCards.at(-1) || "—";
 cardInput.value = "";
  lastCardEl.textContent = drawnCards.at(-1) || "—";
  updateUI();
  updateDealerCard();
  updateRightSide();
  setTimeout(()=> addBtn.disabled = false, 50); // riattiva subito dopo
}

function showMessage(msg) {
  const div = document.createElement("div");
  div.className = "toast";
  div.textContent = msg;
  document.body.appendChild(div);
  setTimeout(()=>div.remove(), 1800);
}


// MONTECARLO
// MONTECARLO INIT
const worker = new Worker('montecarloWorker.js');
console.log('%c🧮 Monte Carlo Worker caricato correttamente!', 'color: limegreen; font-weight: bold;');

 
  

 

// Esempio: simulazione test
const playerHand = { cards: [{ value: 8 }, { value: 8 }], value: 16 };
let fullDeck = [];
for (let i = 1; i <= 13; i++) {
  for (let s = 0; s < 4; s++) fullDeck.push({ value: i });
}
/*
worker.postMessage({
  player: 1,
  hand: playerHand.cards,
  deck: fullDeck,
  simulations: 3000
});*/

// Ascolta le risposte dal worker
worker.onmessage = (e) => {
  const data = e.data;
  // ignora i messaggi di test
  if (data === 'ready' || data?.reply === 'Worker attivo e risponde!') {
    console.log("✅ Worker collegato correttamente");
    //return;
  }
  console.log("📊 Risultati Monte Carlo:", data);

  const playerBox = document.querySelector(`#player-${data.player}`);
  if (!playerBox) return;

  // ✅ Sanifica i valori
  ["hit", "stand", "double", "split"].forEach(move => {
    if (typeof data[move] !== "string" && typeof data[move] !== "number") {
      data[move] = 0;
    }
  });

  playerBox.querySelector('.hit-percent').textContent = `Hit: ${data.hit}%`;
  playerBox.querySelector('.stand-percent').textContent = `Stand: ${data.stand}%`;
  playerBox.querySelector('.double-percent').textContent = `Double: ${data.double}%`;
  playerBox.querySelector('.split-percent').textContent = `Split: ${data.split}%`;
  playerBox.querySelector('.action').textContent = data.bestAction?.toUpperCase() || "—";
};







// left controls
// Supporto iPad + Touch + Input sicuro
gridButtons.forEach(btn => {
  btn.addEventListener("pointerdown", () => addCard(btn.textContent.trim()));
});
  addBtn.addEventListener("pointerdown", () => {
  const val = cardInput.value.trim().toUpperCase();

  if (!val) return; // niente alert se input vuoto

  if (cardValues.includes(val)) {
    addCard(val);
    cardInput.value = ""; // svuota dopo aver aggiunto
  } else {
    showMessage("Carta non valida!"); // usa toast invece di alert per non interrompere
  }
});


cardInput.addEventListener("keypress", e=>{ if (e.key === "Enter") addBtn.click(); });
undoBtn.addEventListener("click", ()=> undoCard());
resetBtn.addEventListener("click", ()=> { if(confirm("Vuoi resettare la partita?")) initDeck(); });
saveBtn.addEventListener("click", saveState);
deckInput.addEventListener("change", ()=> { initDeck(); });

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
  updateDealerCard();
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
    updateDealerCard();
    updateRightSide();
    lastCardEl.textContent = drawnCards.at(-1) || "—";
  } catch (e) {
    console.error("Load error", e);
    initDeck();
  }
}


