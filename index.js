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
  const { playerCards, dealerCard, trueCount, deckState} = req.body;
  console.log(deckState);

  try {
    // 🔸 Chiave API GPT dal file .env su Render
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    // 🔹 Prompt per GPT (puoi personalizzarlo)
    const prompt = `
    Sei un assistente specializzato in Blackjack avanzato. 
Il tuo compito è analizzare lo stato corrente del gioco e dare consigli sulla mossa ottimale. 
Considera le seguenti informazioni che ti vengono passate:

1. La mano del giocatore (valore totale e singole carte, senza semi): ${playerCards.join(", ")}
2. La carta visibile del banco: ${dealerCard}
3. Le carte rimanenti nel mazzo : ${JSON.stringify(deckState)}
4. Eventuali azioni precedenti del giocatore.
5. running count: ${trueCount}

Obiettivi:
- Calcolare la **probabilità che il giocatore non sballi** per ciascuna mossa possibile (hit, stand, double, split se applicabile).
- Calcolare la **probabilità di battere il banco**, stimando il totale possibile del banco in base alle carte rimanenti.
- Suggerire la **mossa ottimale**: hit, stand, double, split o cash out.
  - Il cash out deve essere suggerito se il totale attuale del giocatore è vulnerabile rispetto alla stima del banco.
- Restituire anche i dati di probabilità in un formato JSON chiaro.

Formato di risposta richiesto (JSON):

{
  "mossaConsigliata": "hit | stand | double | split | cash_out",
  "probabilitaNonSballo": 0-1,
  "probabilitaBattereBanco": 0-1,
  "note": "Eventuali osservazioni sul round"
}

Concentrati sul **contesto corrente del mazzo** e sulla strategia più accurata possibile.
Non fare supposizioni senza basi sulle carte già uscite.



    Mano giocatore: ${playerCards.join(", ")}
    Carta dealer: ${dealerCard}
    True Count: ${trueCount.toFixed(2)}
    `;

    // 🔹 Chiamata API GPT
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

    const gptData = await gptResponse.json();

    // 🔹 Estrae testo e prova a convertire in JSON
    let suggestionText = gptData.choices?.[0]?.message?.content || "{}";
    let suggestion;
    try {
      suggestion = JSON.parse(suggestionText);
    } catch {
      suggestion = { message: suggestionText };
    }
console.log("GPT response raw:", suggestionText);

    res.json({
      success: true,
      suggestion,
    });

  } catch (error) {
    console.error("❌ Errore API:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔹 Porta
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Relay server attivo su porta ${PORT}`));
