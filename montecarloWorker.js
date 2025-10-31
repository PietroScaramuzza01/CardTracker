console.log('🟢 Monte Carlo Worker inizializzato e in ascolto...');

// Funzione principale
onmessage = function(e) {
  if (e.data.test) {
    console.log('✅ Worker test ricevuto, pronto a calcolare');
    postMessage('ready');
    return;
  }

  const { player, hand, deck, simulations } = e.data;
  if (!hand || !deck) {
    console.error("❌ Mancano dati per il calcolo:", e.data);
    return;
  }
// Normalizzazione delle carte ricevute
  const normalizedHand = hand.map(normalizeCard);
  const normalizedDeck = deck.map(normalizeCard);
  const results = calculateProbabilities({ cards: hand, value: computeScore(hand) }, deck, simulations);
  results.player = player;
  postMessage(results);
};

// ================================
// MONTE CARLO FUNCTIONS
// ================================

function normalizeCard(card) {
  if (typeof card === 'string') {
    const map = { A: 1, J: 11, Q: 12, K: 13 };
    const val = map[card.toUpperCase()] || parseInt(card);
    return { value: val };
  }
  return card;
}



function calculateProbabilities(hand, deck, nSim = 5000) {
  const cards = hand.cards || hand;
  const results = { hit: 0, stand: 0, double: 0, split: 0 };
const cardsArray = hand.cards || hand; // se già è un array, va bene
const normalizedHand = cardsArray.map(normalizeCard);

  const normalizedDeck = deck.map(normalizeCard);

  const playerValue = computeScore(normalizedHand);
  const canHit = playerValue < 21;
  const canDouble = normalizedHand.length === 2;
  const canSplit =
    normalizedHand.length === 2 &&
    (normalizedHand[0].value === normalizedHand[1].value ||
      (normalizedHand[0].value >= 10 && normalizedHand[1].value >= 10));

  for (let i = 0; i < nSim; i++) {
    if (canHit) results.hit += simulateMove([...normalizedHand], [...normalizedDeck], "hit");
    results.stand += simulateMove([...normalizedHand], [...normalizedDeck], "stand");
    if (canDouble) results.double += simulateMove([...normalizedHand], [...normalizedDeck], "double");
    if (canSplit) results.split += simulateMove([...normalizedHand], [...normalizedDeck], "split");
  }

  for (let move in results) {
    results[move] = ((results[move] / nSim) * 100).toFixed(1);
  }

  // Best move
  const bestAction = Object.entries(results).sort((a, b) => b[1] - a[1])[0][0];
  return { ...results, bestAction };
}


function simulateMove(cards, deck, move) {
  let playerCards = [...cards];
  let localDeck = [...deck];

  switch (move) {
    case 'hit': playerCards.push(drawCard(localDeck)); break;
    case 'double': playerCards.push(drawCard(localDeck)); break;
    case 'split': playerCards = [playerCards[0], drawCard(localDeck)]; break;
    case 'stand': break;
  }

  const playerScore = computeScore(playerCards);
  if (playerScore > 21) return 0;

  const dealerScore = simulateDealer(localDeck);
  if (playerScore > dealerScore) return 1;
  if (playerScore === dealerScore) return 0.5;
  return 0;
}

function simulateDealer(deck) {
  let dealerCards = [drawCard(deck), drawCard(deck)];
  let score = computeScore(dealerCards);

  while (score < 17 || (score === 17 && isSoft17(dealerCards))) {
    dealerCards.push(drawCard(deck));
    score = computeScore(dealerCards);
  }

  return score > 21 ? 0 : score;
}

function computeScore(cards) {
  let sum = 0, aces = 0;
  for (let c of cards) {
    if (c.value === 1) aces++;
    sum += c.value > 10 ? 10 : c.value;
  }
  while (aces > 0 && sum + 10 <= 21) { sum += 10; aces--; }
  return sum;
}

function isSoft17(cards) {
  return computeScore(cards) === 17 && cards.some(c => c.value === 1);
}

function drawCard(deck) {
  const idx = Math.floor(Math.random() * deck.length);
  return deck.splice(idx, 1)[0];
}
