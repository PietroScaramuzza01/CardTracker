import express from "express";
import cors from "cors";
import dotenv from "dotenv";


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
  // Destructuring - prendi tutto quello che il frontend dovrebbe inviare
  const {
    summary,
    playerCards,
    dealerCard,
    deckState,
    roundHistory,
    roundId,
    boxes,
    runningCount,
    remainingCards,
    drawnCards,
    gameHistory, 
    totalCards
  } = req.body;

  console.log("🎲 roundId:", roundId, "events:", (roundHistory && roundHistory.length) || 0);

  // Basic validation
  if (!process.env.OPENAI_API_KEY) {
    console.error("🔑 OPENAI_API_KEY mancante");
    return res.status(500).json({ success: false, error: "Server misconfiguration: OPENAI_API_KEY mancante" });
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

    // Safe stringify helpers with truncation to avoid prompt troppo grande
    const safeStringify = (obj, maxLen = 8_000) => {
      try {
        const s = JSON.stringify(obj, null, 2);
        if (s.length > maxLen) return s.slice(0, maxLen) + "\n... (troncato)";
        return s;
      } catch (e) {
        return String(obj);
      }
    };

    const lastEvents = Array.isArray(roundHistory) ? roundHistory.slice(-100) : [];
    const drawnSample = Array.isArray(drawnCards) ? drawnCards.slice(-200) : [];
    const historySample = Array.isArray(gameHistory) ? gameHistory.slice(-200) : [];
const safeTotalCards = Number.isFinite(totalCards)
  ? totalCards
  : (deckState ? Object.values(deckState).reduce((a, b) => a + b, 0) : 0);

    // 🔹 Prompt per GPT (puoi personalizzarlo)
    const prompt = `
Agisci come un esperto di Blackjack con competenze avanzate in:
- teoria delle probabilità
- simulazioni Monte Carlo
- conteggio delle carte (Hi-Lo system)
- analisi sequenziale delle decisioni (storia delle mosse)

Il tuo compito è analizzare lo stato attuale del gioco e la cronologia completa delle carte e delle azioni, quindi restituire la decisione ottimale per il box specificato.

DATI DISPONIBILI
TAgisci come un esperto di Blackjack con competenze avanzate in:
- teoria delle probabilità
- simulazioni Monte Carlo
- conteggio delle carte (Hi-Lo)
- analisi sequenziale delle decisioni (cronologia delle mosse)

DATI:
summary del box:
${safeStringify(summary, 3000)}

deckState:
${safeStringify(deckState, 3000)}

remainingCards: ${remainingCards}
runningCount: ${runningCount}
dealerCard: ${dealerCard}

boxes (stato attuale):
${safeStringify(boxes, 4000)}

ultimi eventi del round (slice -100):
${safeStringify(lastEvents, 8000)}

estratto drawnCards (ultime 200):
${safeStringify(drawnSample, 4000)}

estratto gameHistory (ultimi 200):
${safeStringify(historySample, 4000)}

playerCards (target):
${safeStringify(playerCards, 2000)}


SIGNIFICATO DEI CAMPI DI SUMMARY

- total: totale attuale della mano del giocatore
- soft: valore della mano se considera un Asso come 11 
- isSoft: true se la mano è soft
- isPair: true se le due carte iniziali sono una coppia
- dealerValue: valore della carta visibile del banco
- trueCount: running count normalizzato per i mazzi rimanenti
- highPct / lowPct: probabilità relative di carte alte e basse rimanenti nel mazzo


IPOTESI DI GIOCO

- Il banco si ferma su 17 (stand su soft 17)
- Il mazzo contiene ${(deckState && Object.values(deckState).reduce((a,b)=>a+b,0)) || 0} carte rimanenti
- Gli Assi possono valere 1 o 11 -> se il giocatore sta l'asso vale 11 se la somma 21, se il giocatore chiama e la somma con 11 supera 21 allora l'asso vale 1 (come le regole di blackjack)
- Azioni permise: **hit**, **stand**, **double** (solo se il player ha due carte), **split**, **cash_out**
- Il mazzo è composto da ${safeTotalCards} carte, la catting card viene inserita circa a metà mazzo quindi il dealer ne userà circa la metà
COMPITO

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

FORMATO DI RISPOSTA (OBBLIGATORIO)

Rispondi esclusivamente con JSON valido:

{
  "mossaConsigliata": "hit | stand | double | split | cash_out",
  "probabilitaNonSballo": numero tra 0 e 1,
  "probabilitaBattereBanco": numero tra 0 e 1,
  "valoreAtteso": numero tra -1 e +1
  "Ragionamento": Perchè sei arrivato a questa conclusione e calcoli 
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

    if (!gptResponse.ok) {
      // stampa body di errore per debug
      const errText = await gptResponse.text().catch(()=>"<no body>");
      console.error("Errore OpenAI:", gptResponse.status, errText);
      throw new Error(`Errore GPT (${gptResponse.status})`);
    }

    const gptData = await gptResponse.json();
    const suggestionText = (gptData.choices?.[0]?.message?.content) || "";
    console.log("🧾 suggestionText (raw):", suggestionText.slice(0, 2000)); // log troncato

    // robust JSON parse: trova primo { e l'ultima } compatibile (semplice)
    const parseJsonFromText = (text) => {
      if (!text || typeof text !== "string") return {};
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start === -1 || end === -1 || end <= start) return {};
      const candidate = text.slice(start, end + 1);
      try {
        return JSON.parse(candidate);
      } catch (e) {
        // fallback: prova a sanificare virgole finali
        try {
          const cleaned = candidate.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
          return JSON.parse(cleaned);
        } catch (err) {
          console.warn("parseJsonFromText failed:", err);
          return {};
        }
      }
    };

    const parsed = parseJsonFromText(suggestionText);

    // Normalizza / sanitize i valori numerici e range
    const toFloat01 = (v, fallback) => {
      const n = typeof v === "number" ? v : parseFloat(v);
      if (!Number.isFinite(n)) return fallback;
      if (n < 0) return 0;
      if (n > 1) return Math.max(Math.min(n, 1), fallback);
      return n;
    };

    const suggestion = {
      mossaConsigliata: parsed.mossaConsigliata ?? "stand",
      probabilitaNonSballo: toFloat01(parsed.probabilitaNonSballo, 1),
      probabilitaBattereBanco: toFloat01(parsed.probabilitaBattereBanco, 0.5),
      valoreAtteso: typeof parsed.valoreAtteso === "number" ? Math.max(Math.min(parsed.valoreAtteso, 1), -1) : (parseFloat(parsed.valoreAtteso) || 0)
    };

    console.log(`📩 Suggerimento generato per roundId ${roundId}:`, suggestion);

    return res.json({
      success: true,
      suggestion,
      ...suggestion // compatibilità frontend
    });

  } catch (error) {
    console.error("❌ Errore API:", error);
    return res.status(500).json({ success: false, error: error.message });
  }
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("🚀 API Blackjack attiva su porta", PORT);
});
