import "dotenv/config";
import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import admin from "firebase-admin";
import fs from "fs";

// On récupère la variable d'environnement
const apiKey = process.env.API_KEY;

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 Limite anti-spam (important)
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30, // 30 requêtes / minute
});
app.use(limiter);

// 🔑 Firebase Admin
const serviceAccount = JSON.parse(
  fs.readFileSync("./serviceAccountKey.json", "utf8")
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

app.post("/score", async (req, res) => {
  try {
    const { pseudo, score, apiKey: userApiKey } = req.body;

    if (userApiKey !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!pseudo || typeof score !== "number") {
      return res.status(400).json({ error: "Invalid payload" });
    }

    await db.collection("scores").add({
      pseudo,
      score,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/leaderboard", async (req, res) => {
  const snapshot = await db
    .collection("scores")
    .orderBy("score", "desc")
    .limit(20)
    .get();

  const scores = snapshot.docs.map((d) => d.data());
  res.json(scores);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port", PORT));
