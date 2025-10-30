// Funzione principale
onmessage = function(e) {
  const { hand, deck, simulations } = e.data;
  const results = calculateProbabilities(hand, deck, simulations);
  postMessage(results);
}

// ================================
// MONTE CARLO FUNCTIONS
// ================================
function calculateProbabilities(hand, deck, nSim = 5000) {
  const results = { hit: 0, stand: 0, double: 0, split: 0 };

  const canHit = hand.value < 21;
  const canDouble = hand.cards.length === 2;
  const canSplit = hand.cards.length === 2 && (hand.cards[0].value === hand.cards[1].value || hand.cards[0].value === 10);

  for (let i = 0; i < nSim; i++) {
    if (canHit) results.hit += simulateMove([...hand.cards], [...deck], 'hit');
    results.stand += simulateMove([...hand.cards], [...deck], 'stand');
    if (canDouble) results.double += simulateMove([...hand.cards], [...deck], 'double');
    if (canSplit) results.split += simulateMove([...hand.cards], [...deck], 'split');
  }

  for (let move in results) {
    results[move] = ((results[move] / nSim) * 100).toFixed(1) + '%';
  }

  return results;
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
