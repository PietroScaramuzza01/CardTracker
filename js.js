


window.addEventListener("load", () => {
  // Cancella eventuali salvataggi automatici
  //localStorage.removeItem("cardTrackerState");

  // Reinizializza tutto
  if (typeof resetGame === "function") resetGame();
  console.log("🔄 Stato azzerato all'avvio");

  console.log("V.J.S. 0.1.0");
});
document.getElementById("clear-storage").addEventListener("click", () => {
  localStorage.removeItem("cardTrackerState");
  showMessage("Archivio locale cancellato ❌");
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
let currentActiveBoxIndex = null;

let selectedBoxIndex = null; // impostata quando premi “Aggiorna” su un box
// CRONOLOGIA LOCALE — per round e per sessione
let roundId = null;
let roundHistory = []; // array di eventi { ts, type, payload }
let gameHistory = []; // opzionale: cronologia di round multipli

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

// --- COLLEGA I PULSANTI "AGGIORNA" AI BOX ---
document.querySelectorAll('.player-box').forEach((boxEl, index) => {
  const btn = boxEl.querySelector('.update-suggestion');
  if (btn) {
    btn.addEventListener('click', () => {
      selectBoxForUpdate(index);
      highlightSelectedBox(index);
    });
  }
});

// --- FUNZIONE DI EVIDENZIAZIONE VISIVA DEL BOX SELEZIONATO ---
function highlightSelectedBox(index) {
  document.querySelectorAll('.player-box').forEach((b, i) => {
    b.classList.toggle('selected', i === index && index !== null);
  });
}





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
  roundId = `round_${Date.now()}`;
  roundHistory = [];
  
  roundHistory.push({ ts: Date.now(), type: "round_start", payload: { roundId, numDecks }});
 
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
function isInitialDistributionComplete() {
  const allBoxesReady = boxes.every(b => !b.active || b.cards.length >= 2);
  return dealerCard && allBoxesReady;
}
// --- UPDATE UI SINISTRA ---
function updateUI() {
  console.log("DEBUG updateUI:", { remainingCards, runningCount, deckState: {...deckState} });

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
  const dealerEl = document.getElementById("dealer-card");
  if (!dealerEl) return;

  if (!dealerCard) {
    console.warn("dealerCard non definito, ma aggiorno comunque le box");
    dealerEl.textContent = "—";
    return;
  }

  dealerEl.textContent = dealerCard;
  console.log(`🂠 Dealer mostra: ${dealerCard}`);
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


function pushRoundEvent(type, payload = {}) {
  const ev = { ts: Date.now(), type, payload };
  roundHistory.push(ev);
  // trimmed history to avoid huge payloads (keep last 200 events)
  const MAX_EVENTS = 200;
  if (roundHistory.length > MAX_EVENTS) roundHistory = roundHistory.slice(-MAX_EVENTS);
  // per debug
  // console.log("roundEvent", ev);
}

function recordCardPlay(card, recipient) {
  // recipient: "DEALER" o box index (number)
  pushRoundEvent("card_play", { card, recipient, remainingCards, runningCount });
}
function recordPlayerAction(boxIndex, action, bet = null) {
  pushRoundEvent("player_action", { boxIndex, action, bet, cards: [...boxes[boxIndex].cards] });
}
function recordDealerAction(action, card = null) {
  pushRoundEvent("dealer_action", { action, card });
}
function recordRoundEnd(result) {
  pushRoundEvent("round_end", result || {});
  // archive to gameHistory
  gameHistory.push({ roundId, events: roundHistory.slice(), endedAt: Date.now(), result });
  // new round id for next round if you want
  roundId = `round_${Date.now()}`;
  roundHistory = [{ ts: Date.now(), type: "round_start", payload: { roundId } }];
}
function applyCardEffects(card) {
  // TODO: implementa gli effetti della carta (es: aggiornamento conteggi, modifiche box)
  console.log("applyCardEffects chiamata per:", card);
}

// esempio funzione di selezione (da chiamare nel click del pulsante "Aggiorna")
function selectBoxForUpdate(index) {
  selectedBoxIndex = index;
  console.log(`🎯 Box ${index + 1} selezionato per aggiornamento manuale`);
}

async function addCard(card) {
  if (!card) {
    console.warn("⚠️ addCard: nessuna carta fornita");
    return;
  }

  // normalizza input (string come "10","J","A")
  card = card.toString().toUpperCase();

  // sicurezza: il valore deve essere valido
  if (!cardValues.includes(card)) {
    console.warn("addCard: carta non valida", card);
    return;
  }

  // --- AGGIORNA STATO DEL MAZZO (prima di assegnare) ---
  if (!deckState || typeof deckState[card] === "undefined") {
    // ricrea stato mazzo se necessario
    cardValues.forEach(c => { if (!deckState[c]) deckState[c] = 4 * numDecks; });
  }

  if (!deckState[card] || deckState[card] <= 0) {
    showMessage("Tutte le carte di questo valore sono già uscite!");
    console.warn("addCard: carta esaurita", card);
    return;
  }

  // decrementa mazzo, aggiorna conteggi
  deckState[card]--;
  remainingCards--;
  runningCount += hiLoValues[card] || 0;
  drawnCards.push(card);
  lastCardEl.textContent = card;

  // 🔹 1. Fase iniziale: distribuzione automatica
  if (!isInitialDistributionComplete()) {
    assignNextInitialCard(card);
    return;
  }

  // 🔹 2. Fase di gioco: assegna solo se è stato selezionato un box
  let recipientIndex = null;

  // se è stato selezionato manualmente un box, usalo
  // Se è stato selezionato un box tramite “Aggiorna”
  if (selectedBoxIndex !== null) {
    recipientIndex = selectedBoxIndex;
    console.log(`📍 Carta destinata al box ${recipientIndex + 1} (selezionato manualmente)`);

    // Dopo aver usato la carta, disattiva la selezione
    selectedBoxIndex = null;
    highlightSelectedBox(null);
  } 
  // fallback opzionale: se non è selezionato nessun box ma è impostato nextCardBoxId
  else if (nextCardBoxId) {
    recipientIndex = nextCardBoxId - 1;
    nextCardBoxId = null;
  }
  // altrimenti, nessun box selezionato ⇒ non assegnare
  else {
    console.warn("⚠️ addCard: nessun box selezionato, la carta non sarà assegnata");
    updateUI();
    updateDealerCard();
    updateRightSide();
    return;
  }

  const box = boxes[recipientIndex];
  if (!box) {
    console.warn(`⚠️ addCard: box ${recipientIndex + 1} inesistente`);
    return;
  }

  if (!box.active) {
    console.warn(`⚠️ addCard: box ${recipientIndex + 1} non attivo`);
    return;
  }

  if (!box.owner) {
    console.warn(`⚠️ addCard: box ${recipientIndex + 1} non è di tua proprietà`);
    return;
  }

  // assegna la carta
  box.cards.push(card);
  assignmentHistory.push({
    card,
    recipient: recipientIndex,
    phase: "manual",
  });
// 📌 ——— AGGIORNA GAME HISTORY PER LA MEMORIA LOCALE ———
gameHistory.push({
  action: "add_card",
  timestamp: Date.now(),
  card,
  recipient: recipientIndex,
  runningCount,
  trueCount: remainingCards > 0 ? runningCount / (remainingCards/52) : 0,
  deckState: { ...deckState },
  drawnCards: [...drawnCards],
  boxes: boxes.map(b => ({
    id: b.id,
    owner: b.owner,
    active: b.active,
    cards: [...b.cards]
  })),
  dealerCard
});

  // aggiorna suggerimento solo se dealerCard è noto
  if (dealerCard && !nextBox.suggestionRequested) {
  nextBox.suggestionRequested = true;
  const result = await computeSuggestionForBox(idx);
  nextBox.suggestion = result?.action || "—";
}


  // aggiorna la UI
  updateUI();
  updateDealerCard();
  updateRightSide();
await updateRightSide();

  console.log(`🃏 addCard: aggiunta carta ${card} al box ${recipientIndex + 1}`);
}




 dealerCard = dealerCard || null;
async function assignNextInitialCard(card) {
  const activeBoxes = boxes.filter(b => b.active);
  const totalCardsDealt = activeBoxes.reduce((sum, b) => sum + b.cards.length, 0);
  const dealerHasCard = !!dealerCard;

  // --- 1° giro: prima carta ai giocatori ---
  if (totalCardsDealt < activeBoxes.length) {
    const nextBox = activeBoxes[totalCardsDealt];
    nextBox.cards.push(card);

    const idx = boxes.indexOf(nextBox);
    assignmentHistory.push({ card, recipient: idx, phase: "initial" });

    applyCardEffects(card);
    checkInitialDistributionComplete();
    updateUI();
updateRightSide();

    return;
  }

  // --- 2° giro: carta dealer ---
  if (!dealerHasCard) {
    dealerCard = card;

    assignmentHistory.push({ card, recipient: "DEALER", phase: "initial" });
    recordCardPlay(card, "DEALER");

    applyCardEffects(card);
    checkInitialDistributionComplete();
    updateUI();
updateRightSide();

    return;
  }

  // --- 3° giro: seconda carta ai giocatori ---
  const boxesWithOneCard = activeBoxes.filter(b => b.cards.length === 1);
  if (boxesWithOneCard.length > 0) {
    const nextBox = boxesWithOneCard[0];
    nextBox.cards.push(card);

    const idx = boxes.indexOf(nextBox);
    assignmentHistory.push({ card, recipient: idx, phase: "initial" });

    applyCardEffects(card);
    checkInitialDistributionComplete();
    updateUI();
updateRightSide();


    if (dealerCard) {
      const result = await computeSuggestionForBox(idx);
      nextBox.suggestion = result?.action || "—";
    }

    return;
  }

  console.warn("assignNextInitialCard: nessun destinatario per", card);
}






async function checkInitialDistributionComplete() {
  const activeBoxes = boxes.filter(b => b.active);

  // Nessun box attivo? Niente da controllare
  if (activeBoxes.length === 0) {
    initialDistributionComplete = false;
    return false;
  }

  // Controlla che ogni box attivo abbia due carte
  const allBoxesHaveTwo = activeBoxes.every(b => b.cards.length >= 2);

  // Controlla che il dealer abbia ricevuto la carta
  const dealerReady = !!dealerCard;

  // Se tutto è completo, segna la distribuzione iniziale come completa
  if (allBoxesHaveTwo && dealerReady) {
    if (!initialDistributionComplete) {
      console.log("✅ Distribuzione iniziale completata!");
    }
    initialDistributionComplete = true;

    // Aggiorna i suggerimenti per tutti i box attivi
    for (const b of activeBoxes) {
  const boxIndex = boxes.indexOf(b);
  const suggestionResult = await computeSuggestionForBox(boxIndex);
  b.suggestion = suggestionResult?.action || "—";
  console.log(
    `🎯 Box ${boxIndex + 1} (Ready) - Carte: [${b.cards.join(", ")}], Suggerimento: ${b.suggestion}`
  );
}


    updateDealerCard();
    updateRightSide();
    return true;
  }

  // Se non completo
  initialDistributionComplete = false;
  return false;
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


// --- UPDATE SUGGESTIONS helper ---
async function updateAllSuggestions() {
  if (!dealerCard) return; // sicurezza
  boxes.forEach(async(b, idx) => {
    if (b.active && b.owner && b.cards.length > 0) {
      const res = await computeSuggestionForBox(idx);
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
async function undoCard(){
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
gameHistory.push({
  action: "undo_card",
  timestamp: Date.now(),
  card: last,
  recipient: lastAssign.recipient,
  runningCount,
  trueCount: remainingCards > 0 ? runningCount / (remainingCards/52) : 0,
  deckState: { ...deckState },
  drawnCards: [...drawnCards],
  boxes: boxes.map(b => ({
    id: b.id,
    owner: b.owner,
    active: b.active,
    cards: [...b.cards]
  })),
  dealerCard
});
// Aggiorna suggerimento per il box se il dealer è noto
if (lastAssign.recipient !== "DEALER" && typeof lastAssign.recipient === "number" && dealerCard) {
  const suggestionResult = await computeSuggestionForBox(lastAssign.recipient);
  boxes[lastAssign.recipient].suggestion = suggestionResult?.action || "—";
}

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

function updateSuggestionUI(boxIndex, res) {
  console.log(res);
  const boxEl = playerBoxes[boxIndex];
  if (!boxEl) return;

  const ui = boxEl; // i box hanno già l'id player-1 ... player-7
  if (!ui) return;

  const suggestedActionEl = ui.querySelector(".suggested-action");
  const noBustEl = ui.querySelector(".no-bust");
  const pvsdEl = ui.querySelector(".player-vs-dealer");
  const valoreAttesoEl = ui.querySelector(".valore-atteso");


  if (!suggestedActionEl || !noBustEl || !pvsdEl || !valoreAttesoEl) {
    console.log("ATTENZIONE - elementi UI mancanti");
    return;
  }

  // 🔹 Dati AI
  const action = res?.mossaConsigliata || '—';
  const probWin = typeof res?.probabilitaBattereBanco === 'number' 
                  ? (res.probabilitaBattereBanco * 100).toFixed(1) + '%' 
                  : '-';
  const probSafe = typeof res?.probabilitaNonSballo === 'number' 
                   ? (res.probabilitaNonSballo * 100).toFixed(1) + '%' 
                   : '-';
  const ev = typeof res?.valoreAtteso === 'number' ? res.valoreAtteso : null;

  // 🔹 Aggiorna la UI con i dati AI
  suggestedActionEl.textContent = `${action.toUpperCase()}`;
  noBustEl.textContent = `${probSafe}`;
  pvsdEl.textContent = `${probWin}`;
  valoreAttesoEl.textContent = ev !== null ? ev.toFixed(3) : '-';

  // 🔹 Colore mossa
  let color = '#ccc';
  if (action === 'hit') color = '#00aaff';
  else if (action === 'stand') color = '#ffaa00';
  else if (action === 'double') color = '#00ff88';
  else if (action === 'split') color = '#ff66ff';
  suggestedActionEl.style.color = color;

  // 🔹 Barra EV visiva
  let bar = boxEl.querySelector('.ev-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.className = 'ev-bar';
    bar.style.height = '6px';
    bar.style.borderRadius = '3px';
    bar.style.marginTop = '4px';
    bar.style.background = '#999';
    ui.querySelector('.suggestion').appendChild(bar);
  }

  if (ev !== null) {
    bar.style.width = `${Math.min(Math.abs(ev) * 100, 100)}%`;
    bar.style.background = ev >= 0 ? '#00ff8855' : '#ff444455';
  } else {
    bar.style.width = '0';
    bar.style.background = '#999';
  }
}



// 🔹 Normalizza EV in percentuali proporzionali (0–1)
/*function normalizeEV(evResult) {
  if (!evResult) return { stand: 0.33, hit: 0.33, double: 0.33, split: 0 };

  const evs = {
    stand: Number.isFinite(evResult.stand_ev) ? evResult.stand_ev : -Infinity,
    hit:   Number.isFinite(evResult.hit_ev)   ? evResult.hit_ev   : -Infinity,
    double: Number.isFinite(evResult.double_ev) ? evResult.double_ev : -Infinity,
    split:  Number.isFinite(evResult.split_ev)  ? evResult.split_ev  : -Infinity,
  };

  // Filtra solo valori finiti
  const valid = Object.entries(evs).filter(([_, v]) => Number.isFinite(v));
  if (!valid.length) return { stand: 0.33, hit: 0.33, double: 0.33, split: 0 };

  // min / max
  const min = Math.min(...valid.map(([_, v]) => v));
  const max = Math.max(...valid.map(([_, v]) => v));
  const spread = max - min;

  const normalized = {};
  if (spread < 1e-9) {
    // tutti uguali -> assegna 1 alla migliore (se c'è tie, divide equamente)
    const bestVal = valid[0][1];
    const ties = valid.filter(([_,v]) => Math.abs(v - bestVal) < 1e-9).map(([k]) => k);
    for (const [k] of valid) normalized[k] = ties.includes(k) ? 1 / ties.length : 0;
  } else {
    let total = 0;
    for (const [k, v] of valid) {
      normalized[k] = (v - min) / spread;
      total += normalized[k];
    }
    for (const k in normalized) normalized[k] = normalized[k] / (total || 1);
  }

  // Assicura tutte le chiavi presenti
  return {
    stand: normalized.stand ?? 0,
    hit: normalized.hit ?? 0,
    double: normalized.double ?? 0,
    split: normalized.split ?? 0
  };
}
*/
const API_URL = "https://cardtracker-2.onrender.com";
/*
async function inviaRound(dati) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dati)
  });
  const result = await res.json();
  console.log("Suggerimento:", result.suggestion);
}

*/

function computeLocalStats(box, dealerCard, deckState, runningCount, remainingCards) {
  // Calcola punteggio giocatore
  const values = box.cards.map(c => getCardBaseValue(c));
  const hasAce = box.cards.includes("A");
  let total = values.reduce((a,b)=>a+b,0);
  let soft = hasAce && total <= 11 ? total + 10 : total;
  if (soft > 21) soft = total; // gestisci Asso

  // Tipo di mano
  const isPair = box.cards.length === 2 && box.cards[0] === box.cards[1];
  const isSoft = hasAce && total <= 11;

  // Dealer
  const dealerValue = getCardBaseValue(dealerCard);

  // True count
  const decksRemaining = remainingCards / 52;
  const trueCount = decksRemaining > 0 ? runningCount / decksRemaining : 0;

  // Stima di composizione mazzo (percentuali alte/basse)
  const totalCards = deckTotal(deckState);
  const highCount = ["10","J","Q","K","A"].reduce((s,c)=>s+(deckState[c]||0),0);
  const lowCount  = ["2","3","4","5","6"].reduce((s,c)=>s+(deckState[c]||0),0);

  const highPct = highCount / totalCards;
  const lowPct  = lowCount / totalCards;

  return {
    total,
    soft,
    isSoft,
    isPair,
    dealerValue,
    trueCount,
    highPct,
    lowPct,
    numCards: box.cards.length,
  };
}


// --------- computeSuggestionForBox (rivista) ----------
async function computeSuggestionForBox(boxIndex) {
  const box = boxes[boxIndex];
  if (!box || !box.active || !box.owner || !box.cards?.length || !dealerCard || dealerCard === "—") {
    updateSuggestionUI(boxIndex, { mossaConsigliata: "—", probabilitaBattereBanco: 0, probabilitaNonSballo: 0, valoreAtteso: 0 });
    return { action: "—", ev: 0, trueCount: 0 };
  }

  const localStats = computeLocalStats(box, dealerCard, deckState, runningCount, remainingCards);
  console.log("📊 Dati locali calcolati:", localStats);

  try {
    const decksRemaining = remainingCards / 52;
    const tc = decksRemaining > 0 ? runningCount / decksRemaining : 0;

    const payload = {
  targetBoxIndex: boxIndex,
  targetTotalCards : totalCards,
  targetBoxCards: box.cards,
  summary: localStats,
  dealerCard,
  runningCount,
  remainingCards,
  trueCount: tc,
  deckState: { ...deckState },
  drawnCards: [...drawnCards],

  // 👇 AGGIUNGI QUESTO BLOCCO
  currentRound: {
    roundId,
    initialDistributionComplete,
    roundHistory: [...roundHistory],
    boxes: boxes.map(b => ({
      id: b.id,
      active: b.active,
      owner: b.owner,
      cards: [...b.cards],
      suggestion: b.suggestion
    })),
    dealerCard
  }
};


    console.log("🚀 Invio dati round al server:", payload);

   const response = await fetch("https://cardtracker-2.onrender.com/api/suggestion", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

const data = await response.json();

console.log("📩 Risposta server:", data);
// --- controlla varie forme di risposta ---
if (data?.mossaConsigliata) {
  updateSuggestionUI(boxIndex, data);
  return {
    action: data.mossaConsigliata,
    ev: data.valoreAtteso ?? 0,
    trueCount: tc,
    stats: {
      noBust: data.probabilitaNonSballo,
      pvsd: data.probabilitaBattereBanco
    }
  };
}

// ✅ caso server: { success:true, suggestion:{...} }
if (data?.suggestion?.mossaConsigliata) {
  updateSuggestionUI(boxIndex, data.suggestion);
  return {
    action: data.suggestion.mossaConsigliata,
    ev: data.suggestion.valoreAtteso ?? 0,
    trueCount: tc,
    stats: {
      noBust: data.suggestion.probabilitaNonSballo,
      pvsd: data.suggestion.probabilitaBattereBanco
    }
  };
}

// fallback alternativo
if (data?.result) {
  updateSuggestionUI(boxIndex, data.result);
  return {
    action: data.result.mossaConsigliata,
    ev: data.result.valoreAtteso ?? 0,
    trueCount: tc,
    stats: {
      noBust: data.result.probabilitaNonSballo,
      pvsd: data.result.probabilitaBattereBanco
    }
  };
}


// Altrimenti fallback
console.warn("⚠️ computeSuggestionForBox: risposta inattesa", data);
updateSuggestionUI(boxIndex, { 
  mossaConsigliata: "—", 
  probabilitaBattereBanco: 0, 
  probabilitaNonSballo: 0, 
  valoreAtteso: 0 
});
//return { action: "—", ev: 0, trueCount: tc };


    const suggestionData = data?.suggestion || {
      mossaConsigliata: "—",
      probabilitaBattereBanco: 0,
      probabilitaNonSballo: 0,
      valoreAtteso: 0
    };

    // Salvo la suggestion per eventuali controlli futuri
    box.suggestion = suggestionData;

    // Aggiorno la UI con i nomi esatti che arrivano dall'AI
    updateSuggestionUI(boxIndex, suggestionData);

    return {
      action: suggestionData.mossaConsigliata || "—",
      ev: suggestionData.valoreAtteso || 0,
      trueCount: tc,
      stats: {
        noBust: suggestionData.probabilitaNonSballo,
        pvsd: suggestionData.probabilitaBattereBanco
      }
    };

  } catch (err) {
    console.error("❌ Errore nel contatto con API o Render:", err);
    updateSuggestionUI(boxIndex, { mossaConsigliata: "—", probabilitaBattereBanco: 0, probabilitaNonSballo: 0, valoreAtteso: 0 });
    return { action: "—", ev: 0, trueCount: tc };
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


