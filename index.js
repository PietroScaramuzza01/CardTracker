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
  const { summary, playerCards, dealerCard, deckState } = req.body;
  console.log("🧮 Ricevuto summary:", summary);
  console.log("📊 Deck state:", deckState);

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;


    // 🔹 Prompt per GPT (puoi personalizzarlo)
    const prompt = `
Agisci come un esperto di Blackjack con competenze statistiche e di conteggio carte (Hi-Lo system).  
Il tuo compito è analizzare lo stato attuale del mazzo e della mano e restituire una decisione di gioco ottimale basata su calcolo probabilistico e simulazione Monte Carlo.

Ecco i dati forniti:
${JSON.stringify(summary, null, 2)}

Significato dei campi:
- total: totale della mano del giocatore
- soft: valore soft (se c’è un asso che può valere 11)
- isSoft: true se la mano è soft
- isPair: true se le carte sono una coppia
- dealerValue: valore carta visibile del banco
- trueCount: running count normalizzato per i mazzi rimanenti
- highPct / lowPct: probabilità relative di carte alte e basse rimanenti

Azioni possibili: **hit**, **stand**, **double**, **split**, **cash_out**

Ipotizza che:
- Il banco si ferma su 17 (stand su soft 17).
- Il mazzo è composto da ${Object.values(deckState).reduce((a,b)=>a+b,0)} carte rimanenti.
- Stato del mazzo (numero di carte rimanenti per valore): ${JSON.stringify(deckState)}
- Gli assi possono valere 1 o 11 a seconda del contesto.
- Il giocatore può scegliere tra: hit, stand, double, split, cash_out.

Compito:
1. Stima le probabilità di ciascuna mossa:
   - Probabilità di NON sballare con **Hit**.
   - Probabilità di vincere contro il banco con **Stand**.
   - Probabilità attesa di vincita con **Double**.
   - Probabilità di vantaggio medio con **Split** (se carte uguali).
   - Probabilità attesa di mantenere un EV positivo con **Cash Out**.
2. Fai una simulazione Monte Carlo (simula 1000 round) o ragionamento probabilistico avanzato basato sul conteggio carte.
3. Scegli la **mossa ottimale** (quella con il valore atteso di vincita più alto).
4. Restituisci il risultato in formato JSON puro

Formato di risposta richiesto (solo json):
{
  "mossaConsigliata": "hit | stand | double | split | cash_out",
  "probabilitaNonSballo": numero tra 0 e 1,
  "probabilitaBattereBanco": numero tra 0 e 1,
  "valoreAtteso": numero tra -1 e +1
}

fai attenzione al formato di output! le variabili devono chiamarsi cosi.

Restituisci solo JSON valido.  Nessun testo o spiegazione fuori dal formato.
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

    if (!gptResponse.ok) throw new Error(`Errore GPT (${gptResponse.status})`);

    const gptData = await gptResponse.json();
    let suggestionText = gptData.choices?.[0]?.message?.content || "{}";

    // 🔹 Default suggestion
    let suggestion;

    // 🔹 Prova a parsare la risposta GPT
    try {
      const parsed = JSON.parse(suggestionText);
      suggestion = {
        mossaConsigliata: parsed.mossaConsigliata || suggestion.mossaConsigliata,
        probabilitaNonSballo: parsed.probabilitaNonSballo ?? suggestion.probabilitaNonSballo,
        probabilitaBattereBanco: parsed.probabilitaBattereBanco ?? suggestion.probabilitaBattereBanco,
        valoreAtteso: parsed.valoreAtteso ?? suggestion.valoreAtteso
      };
    } catch (err) {
      console.warn("⚠️ GPT response non JSON, uso valori di default:", suggestionText);
    }

    console.log("📩 Risposta suggerimento:", suggestion);

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
