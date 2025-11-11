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
  const { playerCards, dealerCard, trueCount } = req.body;

  try {
    // 🔸 Chiave API GPT dal file .env su Render
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    // 🔹 Prompt per GPT (puoi personalizzarlo)
    const prompt = `
    Agisci come un esperto di blackjack e conteggio carte. 
Analizza la situazione e consiglia la mossa ottimale considerando:
- la strategia base,
- il True Count (vantaggio del giocatore),
- la carta del dealer,
- la possibilità di raddoppio o split.

Rispondi SOLO in formato JSON come questo:
{
  "mossa": "hit | stand | double | split",
  "probabilita": { "vittoria": x, "pareggio": x, "sconfitta": x },
  "spiegazione": "..."
}

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Relay server attivo su porta ${PORT}`));
