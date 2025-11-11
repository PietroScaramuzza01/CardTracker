import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("✅ Blackjack Advisor API attiva!");
});

app.post("/analyze", (req, res) => {
  const dati = req.body;
  console.log("📩 Dati ricevuti:", dati);

  // Risposta di esempio
  res.json({
    suggestion: "Hit",
    probabilities: { hit: 0.72, stand: 0.18, double: 0.05, split: 0.05 }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Server attivo su porta ${PORT}`));
