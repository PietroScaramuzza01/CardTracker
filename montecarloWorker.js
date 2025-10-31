console.log('🟢 Monte Carlo Worker inizializzato e in ascolto...');

// ================================
// Funzione principale del worker
// ================================
onmessage = function(e) {
  if (e.data.test) {
    console.log('✅ Worker test ricevuto, pronto a calcolare');
    postMessage('ready');
    return;
  }

  const { player, hand, deck, simulations = 5000 } = e.data;
  if (!hand || !deck) {
    console.error("❌ Mancano dati per il calcolo:", e.data);
    return;
  }

  // Normalizza carte
  const normalizedHand = hand.map(normalizeCard);
  const normalizedDeck = deck.map(normalizeCard);

  // Calcola probabilità
  const results = calculateProbabilities(normalizedHand, normalizedDeck, simulations);
  results.player = player;
  postMessage(results);
};

// ================================
// FUNZIONI DI SUPPORTO
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
  const results = { hit: 0, stand: 0, double: 0, split: 0 };

  const playerValue = computeScore(hand);
  const canHit = playerValue < 21;
  const canDouble = hand.length === 2;
  const canSplit =
    hand.length === 2 &&
    (hand[0].value === hand[1].value || (hand[0].value >= 10 && hand[1].value >= 10));

  for (let i = 0; i < nSim; i++) {
    if (canHit) results.hit += simulateMove([...hand], [...deck], "hit");
    results.stand += simulateMove([...hand], [...deck], "stand");
    if (canDouble) results.double += simulateMove([...hand], [...deck], "double");
    if (canSplit) results.split += simulateMove([...hand], [...deck], "split");
  }

  // Converti in percentuale
  for (let move in results) {
  const val = results[move];
  results[move] = (isNaN(val) ? 0 : (val / nSim) * 100).toFixed(1);
}

  // Determina la migliore azione
 const bestAction = Object.entries(results)
  .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0][0];
return { ...results, bestAction };

}

function simulateMove(cards, deck, move) {
  let playerCards = [...cards];
  let localDeck = [...deck];

  switch (move) {
    case 'hit':
    case 'double':
      playerCards.push(drawCard(localDeck));
      break;
    case 'split':
      playerCards = [playerCards[0], drawCard(localDeck)];
      break;
    case 'stand':
      break;
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
