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

app.post("/register", async (req, res) => {
  try {
    const { email, password, pseudo } = req.body;

    // 🔒 Validation basique
    if (!email || !password || !pseudo) {
      return res.status(400).json({ error: "Missing fields" });
    }

    // 🔎 Vérification pseudo unique
    const pseudoRef = db.collection("pseudos").doc(pseudo);
    const pseudoSnap = await pseudoRef.get();

    if (pseudoSnap.exists) {
      return res.status(409).json({ error: "Pseudo already used" });
    }

    // 👤 Création utilisateur Firebase Auth
    const userRecord = await admin.auth().createUser({
      email,
      password,
    });

    const uid = userRecord.uid;

    // 🧱 Création Firestore atomique
    const batch = db.batch();

    batch.set(pseudoRef, { uid });
    batch.set(db.collection("users").doc(uid), {
      email,
      pseudo,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // 🔑 Création d’un custom token
    const token = await admin.auth().createCustomToken(uid);

    res.json({
      success: true,
      uid,
      token,
    });
  } catch (err) {
    console.error(err);

    if (err.code === "auth/email-already-exists") {
      return res.status(409).json({ error: "Email already used" });
    }

    res.status(500).json({ error: "Server error" });
  }
});

// === Endpoint Login ===
app.post("/login", async (req, res) => {
  try {
    const { email, password, apiKey: clientKey } = req.body;

    // Vérification de la clé côté client
    if (clientKey !== apiKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (!email || !password) {
      return res.status(400).json({ error: "Email et mot de passe requis" });
    }

    // Recherche de l'utilisateur dans Firestore
    const usersRef = db.collection("users");
    const querySnapshot = await usersRef.where("email", "==", email).get();

    if (querySnapshot.empty) {
      return res.status(401).json({ error: "Utilisateur non trouvé" });
    }

    const userDoc = querySnapshot.docs[0];
    const userData = userDoc.data();

    // Ici tu compares le mot de passe (plaintext ou hash selon ton choix)
    if (userData.password !== password) {
      return res.status(401).json({ error: "Mot de passe incorrect" });
    }

    // Création d'un custom token Firebase pour ce user
    const token = await admin.auth().createCustomToken(userDoc.id);

    res.json({
      success: true,
      uid: userDoc.id,
      pseudo: userData.pseudo,
      token,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erreur serveur" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("API running on port", PORT));
