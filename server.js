const express = require("express");
const mongoose = require("mongoose");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const mongoUri = process.env.MONGODB_URI;

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const waitlistSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const WaitlistEntry = mongoose.models.WaitlistEntry || mongoose.model("WaitlistEntry", waitlistSchema);

async function connectMongo() {
  if (!mongoUri) {
    console.log("MONGODB_URI not set. Using local JSON fallback mode.");
    return;
  }

  try {
    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
    console.log("Falling back to local JSON storage.");
  }
}

function readLocalEntries() {
  const filePath = path.join(__dirname, "data", "waitlist.json");

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw.trim() ? JSON.parse(raw) : [];
  } catch (error) {
    return [];
  }
}

function writeLocalEntries(entries) {
  const filePath = path.join(__dirname, "data", "waitlist.json");
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

async function storeWaitlistEmail(email) {
  const normalizedEmail = email.trim().toLowerCase();

  if (mongoose.connection.readyState === 1) {
    const existing = await WaitlistEntry.findOne({ email: normalizedEmail });
    if (existing) {
      return { duplicate: true, source: "mongodb" };
    }

    await WaitlistEntry.create({ email: normalizedEmail });
    return { duplicate: false, source: "mongodb" };
  }

  const entries = readLocalEntries();
  const alreadyExists = entries.some((entry) => entry.email === normalizedEmail);

  if (alreadyExists) {
    return { duplicate: true, source: "local-file" };
  }

  entries.push({
    email: normalizedEmail,
    createdAt: new Date().toISOString(),
  });

  writeLocalEntries(entries);
  return { duplicate: false, source: "local-file" };
}

app.get("/", (req, res) => {
  res.render("index", {
    title: "Movies under the stars & rave",
  });
});

app.post("/api/waitlist", async (req, res) => {
  const email = String(req.body.email || "").trim();
  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  if (!isValidEmail) {
    return res.status(400).json({
      message: "Please provide a valid email address.",
    });
  }

  try {
    const result = await storeWaitlistEmail(email);

    if (result.duplicate) {
      return res.status(409).json({
        message: "This email is already on the waitlist.",
      });
    }

    const message =
      result.source === "mongodb"
        ? "You’re on the waitlist. We’ll keep you posted."
        : "You’re on the waitlist. Your email has been saved locally while MongoDB is not configured.";

    return res.status(201).json({ message });
  } catch (error) {
    console.error("Waitlist save failed:", error);
    return res.status(500).json({
      message: "Something went wrong while saving your email.",
    });
  }
});

app.use(express.static(__dirname));

app.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  await connectMongo();
});
