import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch"; // se usi Node < 18, altrimenti puoi rimuovere

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 🔹 Endpoint test
app.get("/", (req, res) => {
  res.send("✅ Blackjack Advisor Relay API attiva!");
});

// 🔹 Endpoint principale
app.post("/api/suggestion", async (req, res) => {
  
  const { summary, playerCards, dealerCard, deckState, roundHistory, roundId, boxes, runningCount, remainingCards } = req.body;
console.log("🎲 roundId:", roundId, "events:", (roundHistory && roundHistory.length) || 0);

  console.log("🧮 Ricevuto summary:", summary);
  console.log("📊 Deck state:", deckState);

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const lastEvents = (roundHistory && roundHistory.slice(-100)) || [];
    // 🔹 Prompt per GPT (puoi personalizzarlo)
    const prompt = `
Agisci come un esperto di Blackjack con competenze avanzate in:
- teoria delle probabilità
- simulazioni Monte Carlo
- conteggio delle carte (Hi-Lo system)
- analisi sequenziale delle decisioni (storia delle mosse)

Il tuo compito è analizzare lo stato attuale del gioco e la cronologia completa delle carte e delle azioni, quindi restituire la decisione ottimale per il box specificato.

────────────────────────
📌 DATI DISPONIBILI
────────────────────────
Ti fornisco:

1. summary del box da analizzare:
${JSON.stringify(summary, null, 2)}

2. Stato completo del mazzo (deckState):
${JSON.stringify(deckState)}

3. Carte rimanenti nel mazzo: ${remainingCards}  
4. runningCount e trueCount attuali: ${runningCount}  
5. dealerCard visibile ${dealerCard}  
6. Situazione completa di tutti i box (tutti i player boxes)  ${boxes}
7. Cronologia completa del round (gameHistory), che include tutte le carte assegnate, i conteggi al momento dell’evento e lo stato dei box. ${lastEvents}
8. Le carte del player: ${playerCards}
Questi dati rappresentano **la memoria perfetta dell’intero round**, quindi puoi ricostruire ogni informazione utile per calcolare in modo preciso il valore atteso delle possibili azioni.

────────────────────────
📌 SIGNIFICATO DEI CAMPI DI SUMMARY
────────────────────────
- total: totale attuale della mano del giocatore
- soft: valore della mano se considera un Asso come 11
- isSoft: true se la mano è soft
- isPair: true se le due carte iniziali sono una coppia
- dealerValue: valore della carta visibile del banco
- trueCount: running count normalizzato per i mazzi rimanenti
- highPct / lowPct: probabilità relative di carte alte e basse rimanenti nel mazzo

────────────────────────
📌 IPOTESI DI GIOCO
────────────────────────
- Il banco si ferma su 17 (stand su soft 17)
- Il mazzo contiene ${Object.values(deckState).reduce((a,b)=>a+b,0)} carte rimanenti
- Gli Assi possono valere 1 o 11
- Azioni permise: **hit**, **stand**, **double** (solo se il player ha due carte), **split**, **cash_out**

────────────────────────
📌 COMPITO
────────────────────────
Usa *sia lo stato attuale* sia *la cronologia del round* per:

1. Calcolare o stimare tramite simulazione Monte Carlo:
   - Probabilità di NON sballare con **Hit**
   - Probabilità di vincere contro il banco con **Stand**
   - Valore atteso della mossa **Double** (solo se il player ha 2 carte)
   - Vantaggio medio di **Split** (se la mano è splittabile)
   - Valore atteso del **Cash Out**

2. Considerare l’impatto del conteggio carte (running/true count) su:
   - probabilità di pescare carte alte / basse / specifiche
   - probabilità di sballare
   - probabilità che il banco superi o rimanga sotto il punteggio del giocatore

3. Fornire la **mossa ottimale**, quella con il valore atteso più alto.

────────────────────────
📌 FORMATO DI RISPOSTA (OBBLIGATORIO)
────────────────────────
Rispondi esclusivamente con JSON valido:

{
  "mossaConsigliata": "hit | stand | double | split | cash_out",
  "probabilitaNonSballo": numero tra 0 e 1,
  "probabilitaBattereBanco": numero tra 0 e 1,
  "valoreAtteso": numero tra -1 e +1
}

Non aggiungere testo fuori dal JSON.

`;

  // 🔹 Chiamata GPT
    const gptResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2,
      }),
    });

    if (!gptResponse.ok) throw new Error(`Errore GPT (${gptResponse.status})`);
    const gptData = await gptResponse.json();
    const suggestionText = gptData.choices?.[0]?.message?.content || "{}";

    // 🔹 Parsing sicuro JSON da GPT
    const parseJsonFromText = (text) => {
      try {
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start === -1 || end === -1) return {};
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return {};
      }
    };

    const parsed = parseJsonFromText(suggestionText);

    // 🔹 Normalizza valori con fallback
    const suggestion = {
      mossaConsigliata: parsed.mossaConsigliata ?? "stand",
      probabilitaNonSballo: parseFloat(parsed.probabilitaNonSballo) || 1,
      probabilitaBattereBanco: parseFloat(parsed.probabilitaBattereBanco) || 0.5,
      valoreAtteso: parseFloat(parsed.valoreAtteso) || 0,
    };

    console.log(`📩 Suggerimento generato per roundId ${roundId}:`, suggestion);

    res.json({
      success: true,
      suggestion,
      ...suggestion // compatibilità frontend
    });

  } catch (error) {
    console.error("❌ Errore API:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔹 Porta
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Relay server attivo su porta ${PORT}`));