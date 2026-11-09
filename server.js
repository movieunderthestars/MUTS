const express = require("express");
const mongoose = require("mongoose");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

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
  survey: mongoose.Schema.Types.Mixed,
  surveyTokenHash: String,
  surveyTokenExpiresAt: Date,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const WaitlistEntry = mongoose.models.WaitlistEntry || mongoose.model("WaitlistEntry", waitlistSchema);
const SURVEY_TOKEN_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;
const EARLIEST_EVENT_DATE = "2026-12-26";
const LATEST_EVENT_DATE = "2027-01-02";

function createSurveyToken() {
  const token = crypto.randomBytes(32).toString("base64url");
  return {
    token,
    hash: crypto.createHash("sha256").update(token).digest("hex"),
    expiresAt: new Date(Date.now() + SURVEY_TOKEN_LIFETIME_MS),
  };
}

function hashSurveyToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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
  const surveyToken = createSurveyToken();

  if (mongoose.connection.readyState === 1) {
    const existing = await WaitlistEntry.findOne({ email: normalizedEmail });
    if (existing) {
      return { duplicate: true, source: "mongodb" };
    }

    await WaitlistEntry.create({
      email: normalizedEmail,
      surveyTokenHash: surveyToken.hash,
      surveyTokenExpiresAt: surveyToken.expiresAt,
    });
    return { duplicate: false, source: "mongodb", surveyToken: surveyToken.token };
  }

  const entries = readLocalEntries();
  const alreadyExists = entries.some((entry) => entry.email === normalizedEmail);

  if (alreadyExists) {
    return { duplicate: true, source: "local-file" };
  }

  entries.push({
    email: normalizedEmail,
    createdAt: new Date().toISOString(),
    surveyTokenHash: surveyToken.hash,
    surveyTokenExpiresAt: surveyToken.expiresAt.toISOString(),
  });

  writeLocalEntries(entries);
  return { duplicate: false, source: "local-file", surveyToken: surveyToken.token };
}

function getMailConfiguration() {
  const port = Number(process.env.MAIL_PORT);
  const { MAIL_HOST, MAIL_USER, MAIL_PASSWORD, MAIL_FROM, APP_BASE_URL } = process.env;

  if (!MAIL_HOST || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !MAIL_USER || !MAIL_PASSWORD || !MAIL_FROM || !APP_BASE_URL) {
    throw new Error("Configure MAIL_HOST, MAIL_PORT, MAIL_USER, MAIL_PASSWORD, MAIL_FROM, and APP_BASE_URL to send survey reminders.");
  }

  let baseUrl;
  try {
    baseUrl = new URL(APP_BASE_URL);
  } catch {
    throw new Error("APP_BASE_URL must be a valid absolute URL.");
  }

  if (!["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("APP_BASE_URL must use HTTP or HTTPS.");
  }

  return { port, MAIL_HOST, MAIL_USER, MAIL_PASSWORD, MAIL_FROM, baseUrl };
}

async function sendTicketsOnSaleNotification(email, configuration) {
  const { port, MAIL_HOST, MAIL_USER, MAIL_PASSWORD, MAIL_FROM, baseUrl } = configuration;
  const transport = nodemailer.createTransport({
    host: MAIL_HOST,
    port,
    secure: port === 465,
    auth: { user: MAIL_USER, pass: MAIL_PASSWORD },
  });

  await transport.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Tickets are now on sale — Movies under the stars",
    text: [
      "Tickets for Movies under the stars & rave are now on sale!",
      "Visit the official page to reserve your spot:",
      baseUrl.toString(),
      "",
      "Thank you for joining the waitlist.",
    ].join("\n"),
    html: `<p>Tickets for <strong>Movies under the stars &amp; rave</strong> are now on sale!</p><p><a href="${baseUrl.toString()}">Visit the event page and get your tickets</a></p><p>Thank you for joining the waitlist.</p>`,
  });
}

async function sendSurveyReminder(email, token, configuration) {
  const { port, MAIL_HOST, MAIL_USER, MAIL_PASSWORD, MAIL_FROM, baseUrl } = configuration;
  const transport = nodemailer.createTransport({
    host: MAIL_HOST,
    port,
    secure: port === 465,
    auth: { user: MAIL_USER, pass: MAIL_PASSWORD },
  });
  const surveyUrl = new URL("/", baseUrl);
  surveyUrl.searchParams.set("surveyToken", token);

  await transport.sendMail({
    from: MAIL_FROM,
    to: email,
    subject: "Complete your Movies under the stars survey",
    text: [
      "Thanks for joining the Movies under the stars waitlist.",
      "You can complete your event survey using this secure link:",
      surveyUrl.toString(),
      "",
      "This link expires in 7 days and can only be used once.",
    ].join("\n"),
  });
}

app.get("/", (req, res) => {
  res.render("index", {
    title: "Movies under the stars & rave",
  });
});

app.post("/api/waitlist", async (req, res) => {
  const email = String(req.body.email || "").trim();

  if (!isValidEmail(email)) {
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

    return res.status(201).json({ message, surveyToken: result.surveyToken });
  } catch (error) {
    console.error("Waitlist save failed:", error);
    return res.status(500).json({
      message: "Something went wrong while saving your email.",
    });
  }
});

app.get("/api/waitlist/survey", async (req, res) => {
  const token = typeof req.query.token === "string" ? req.query.token : "";
  if (!token || token.length > 100) {
    return res.status(400).json({ message: "A valid survey link is required." });
  }

  try {
    const tokenHash = hashSurveyToken(token);
    const now = new Date();
    const entry = mongoose.connection.readyState === 1
      ? await WaitlistEntry.findOne({
        surveyTokenHash: tokenHash,
        surveyTokenExpiresAt: { $gt: now },
      }).select("_id").lean()
      : readLocalEntries().find((item) =>
        item.surveyTokenHash === tokenHash && new Date(item.surveyTokenExpiresAt) > now
      );

    if (!entry) {
      return res.status(404).json({ message: "This survey link is invalid or has expired." });
    }

    return res.status(200).json({ valid: true });
  } catch (error) {
    console.error("Survey link validation failed:", error);
    return res.status(500).json({ message: "Unable to validate your survey link right now." });
  }
});

app.post("/api/waitlist/survey", async (req, res) => {
  const token = typeof req.body.token === "string" ? req.body.token : "";
  const survey = req.body.survey && typeof req.body.survey === "object" ? req.body.survey : {};
  const name = String(survey.name || "").trim();
  const phone = String(survey.phone || "").trim();
  const email = String(survey.email || "").trim().toLowerCase();
  const ageRange = String(survey.ageRange || "");
  const preferredDate = String(survey.preferredDate || "");
  const groupSize = String(survey.groupSize || "");

  if (
    !token || token.length > 100 ||
    !name || name.length > 100 ||
    !phone || phone.length > 32 ||
    !isValidEmail(email) ||
    !ageRange ||
    !preferredDate ||
    !groupSize
  ) {
    return res.status(400).json({ message: "Please complete the required survey questions." });
  }

  const savedSurvey = {};
  for (const [key, value] of Object.entries(survey)) {
    if (Array.isArray(value)) {
      savedSurvey[key] = value.map((item) => String(item).slice(0, 500));
    } else if (typeof value === "string") {
      savedSurvey[key] = value.trim().slice(0, 500);
    }
  }
  savedSurvey.name = name;
  savedSurvey.phone = phone;
  savedSurvey.email = email;
  savedSurvey.completedAt = new Date();

  try {
    const tokenHash = hashSurveyToken(token);
    const now = new Date();
    if (mongoose.connection.readyState === 1) {
      const entry = await WaitlistEntry.findOneAndUpdate(
        {
          surveyTokenHash: tokenHash,
          surveyTokenExpiresAt: { $gt: now },
        },
        {
          $set: { survey: savedSurvey },
          $unset: { surveyTokenHash: 1, surveyTokenExpiresAt: 1 },
        },
        { new: true },
      );
      if (!entry) return res.status(404).json({ message: "This survey link is invalid or has expired." });
    } else {
      const entries = readLocalEntries();
      const entry = entries.find((item) =>
        item.surveyTokenHash === tokenHash && new Date(item.surveyTokenExpiresAt) > now
      );
      if (!entry) {
        return res.status(404).json({ message: "This survey link is invalid or has expired." });
      }

      entry.survey = { ...savedSurvey, completedAt: savedSurvey.completedAt.toISOString() };
      delete entry.surveyTokenHash;
      delete entry.surveyTokenExpiresAt;
      writeLocalEntries(entries);
    }

    return res.status(200).json({ message: "Survey answers saved." });
  } catch (error) {
    console.error("Survey save failed:", error);
    return res.status(500).json({ message: "Something went wrong while saving your answers." });
  }
});

function requireAdmin(req, res, next) {
  const expectedUsername = process.env.ADMIN_USERNAME;
  const expectedPassword = process.env.ADMIN_PASSWORD;

  if (!expectedUsername || !expectedPassword) {
    return res.status(503).send("Admin access is not configured.");
  }

  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Basic\s+([^\s]+)$/i);
  const decoded = match ? Buffer.from(match[1], "base64").toString("utf8") : "";
  const separator = decoded.indexOf(":");
  const username = separator >= 0 ? decoded.slice(0, separator) : "";
  const password = separator >= 0 ? decoded.slice(separator + 1) : "";
  const digest = (value) => crypto.createHash("sha256").update(value).digest();
  const validUsername = crypto.timingSafeEqual(digest(username), digest(expectedUsername));
  const validPassword = crypto.timingSafeEqual(digest(password), digest(expectedPassword));

  if (!match || !validUsername || !validPassword) {
    res.set("WWW-Authenticate", 'Basic realm="MUTS Admin", charset="UTF-8"');
    return res.status(401).send("Authentication required.");
  }

  return next();
}

app.post("/admin/entries/delete", requireAdmin, async (req, res) => {
  const email = String(req.body.email || "").trim();
  const normalizedEmail = email.toLowerCase();
  if (!isValidEmail(normalizedEmail)) return res.status(400).send("A valid waitlist email is required.");

  if (mongoose.connection.readyState === 1) {
    await WaitlistEntry.deleteOne({ email: normalizedEmail });
  } else {
    const entries = readLocalEntries();
    writeLocalEntries(entries.filter((entry) => String(entry.email || "").toLowerCase() !== normalizedEmail));
  }
  return res.redirect(303, "/admin?notice=entry-deleted");
});

app.post("/admin/reminders", requireAdmin, async (req, res) => {
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") {
    return res.status(403).send("Cross-site reminder requests are not allowed.");
  }
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).send("Cross-origin reminder requests are not allowed.");
      }
    } catch {
      return res.status(403).send("Invalid request origin.");
    }
  }

  const email = String(req.body.email || "").trim().toLowerCase();
  if (!isValidEmail(email)) {
    return res.status(400).send("A valid waitlist email is required.");
  }

  try {
    const mailConfiguration = getMailConfiguration();
    const entry = mongoose.connection.readyState === 1
      ? await WaitlistEntry.findOne({ email })
      : readLocalEntries().find((item) => item.email === email);

    if (!entry) {
      return res.status(404).send("Waitlist entry not found.");
    }
    if (entry.survey && entry.survey.name) {
      return res.status(409).send("This person has already completed the survey.");
    }

    const surveyToken = createSurveyToken();
    if (mongoose.connection.readyState === 1) {
      entry.surveyTokenHash = surveyToken.hash;
      entry.surveyTokenExpiresAt = surveyToken.expiresAt;
      await entry.save();
    } else {
      entry.surveyTokenHash = surveyToken.hash;
      entry.surveyTokenExpiresAt = surveyToken.expiresAt.toISOString();
      const entries = readLocalEntries();
      const index = entries.findIndex((item) => item.email === email);
      entries[index] = entry;
      writeLocalEntries(entries);
    }

    await sendSurveyReminder(email, surveyToken.token, mailConfiguration);
    return res.redirect(303, "/admin?notice=reminder-sent");
  } catch (error) {
    console.error("Survey reminder failed:", error);
    const status = error.message.startsWith("Configure ") || error.message.startsWith("APP_BASE_URL")
      ? 503
      : 500;
    return res.status(status).send(error.message || "Unable to send the survey reminder.");
  }
});

app.post("/admin/incomplete-survey-reminders", requireAdmin, async (req, res) => {
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") {
    return res.status(403).send("Cross-site reminder requests are not allowed.");
  }
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).send("Cross-origin reminder requests are not allowed.");
      }
    } catch {
      return res.status(403).send("Invalid request origin.");
    }
  }

  try {
    const mailConfiguration = getMailConfiguration();
    const entries = mongoose.connection.readyState === 1
      ? await WaitlistEntry.find().lean()
      : readLocalEntries();
    const incompleteEntries = entries.filter((entry) => !(entry.survey && entry.survey.name));
    let sent = 0;
    let failed = 0;

    for (const entry of incompleteEntries) {
      const email = String(entry.email || "").trim().toLowerCase();
      if (!isValidEmail(email)) continue;
      try {
        const surveyToken = createSurveyToken();
        if (mongoose.connection.readyState === 1) {
          entry.surveyTokenHash = surveyToken.hash;
          entry.surveyTokenExpiresAt = surveyToken.expiresAt;
          await WaitlistEntry.updateOne(
            { _id: entry._id },
            { $set: { surveyTokenHash: surveyToken.hash, surveyTokenExpiresAt: surveyToken.expiresAt } }
          );
        } else {
          entry.surveyTokenHash = surveyToken.hash;
          entry.surveyTokenExpiresAt = surveyToken.expiresAt.toISOString();
        }
        await sendSurveyReminder(email, surveyToken.token, mailConfiguration);
        sent += 1;
      } catch (error) {
        console.error(`Incomplete survey reminder failed for ${email}:`, error.message);
        failed += 1;
      }
    }

    if (mongoose.connection.readyState !== 1) {
      writeLocalEntries(entries);
    }
    return res.redirect(303, `/admin?notice=${encodeURIComponent(`survey-reminders-sent:${sent}:${failed}`)}`);
  } catch (error) {
    console.error("Incomplete survey reminders failed:", error);
    const status = error.message.startsWith("Configure ") || error.message.startsWith("APP_BASE_URL") ? 503 : 500;
    return res.status(status).send(error.message || "Unable to send survey reminders.");
  }
});

app.post("/admin/tickets-notification", requireAdmin, async (req, res) => {
  const origin = req.get("origin");
  if (req.get("sec-fetch-site") === "cross-site") {
    return res.status(403).send("Cross-site notification requests are not allowed.");
  }
  if (origin) {
    try {
      if (new URL(origin).host !== req.get("host")) {
        return res.status(403).send("Cross-origin notification requests are not allowed.");
      }
    } catch {
      return res.status(403).send("Invalid request origin.");
    }
  }

  try {
    const mailConfiguration = getMailConfiguration();
    const entries = mongoose.connection.readyState === 1
      ? await WaitlistEntry.find({}, { email: 1 }).lean()
      : readLocalEntries();
    const emails = [...new Set(entries.map((entry) => String(entry.email || "").trim().toLowerCase()).filter(isValidEmail))];

    let sent = 0;
    let failed = 0;
    for (const email of emails) {
      try {
        await sendTicketsOnSaleNotification(email, mailConfiguration);
        sent += 1;
      } catch (error) {
        console.error(`Tickets notification failed for ${email}:`, error.message);
        failed += 1;
      }
    }

    const notice = failed > 0 ? `tickets-notification-partial:${sent}:${failed}` : `tickets-notification-sent:${sent}`;
    return res.redirect(303, `/admin?notice=${encodeURIComponent(notice)}`);
  } catch (error) {
    console.error("Tickets notification failed:", error);
    const status = error.message.startsWith("Configure ") || error.message.startsWith("APP_BASE_URL") ? 503 : 500;
    return res.status(status).send(error.message || "Unable to send the ticket notifications.");
  }
});

function countSurveyAnswers(responses, field) {
  const counts = new Map();
  for (const entry of responses) {
    const value = entry.survey?.[field];
    const values = Array.isArray(value) ? value : value ? [value] : [];
    for (const rawValue of values) {
      const label = String(rawValue).trim();
      if (label) counts.set(label, (counts.get(label) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function estimateAttendance(groupSizes) {
  const estimates = { "Just me": 1, "2 of us": 2, "3–5": 4, "6–10": 8, "More than 10": 11 };
  return groupSizes.reduce((total, entry) => {
    const size = entry.survey?.groupSize;
    return total + (Number.isFinite(Number(size)) ? Number(size) : estimates[size] || 0);
  }, 0);
}

app.get("/admin", requireAdmin, async (req, res) => {
  try {
    const entries = mongoose.connection.readyState === 1
      ? await WaitlistEntry.find().sort({ createdAt: -1 }).lean()
      : readLocalEntries().sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    const responses = entries.filter((entry) => entry.survey && entry.survey.name);
    const surveyCount = (field) => countSurveyAnswers(responses, field);
    const insights = {
      preferredDates: surveyCount("preferredDate"),
      locations: surveyCount("location"),
      movieGenres: surveyCount("movieGenres"),
      snacks: surveyCount("snacks"),
      drinks: surveyCount("drinks"),
      superheroChoices: surveyCount("spidermanOrBatman"),
      davidoOrWizkid: surveyCount("davidoOrWizkid"),
      nigerianMovieStyles: surveyCount("nigerianMovieStyle"),
      ticketPrices: surveyCount("ticketPrice"),
      estimatedAttendance: estimateAttendance(responses),
      completionRate: entries.length ? Math.round((responses.length / entries.length) * 100) : 0,
      eveningInterest: countSurveyAnswers(responses, "eveningStart"),
      nollywoodInterest: surveyCount("nollywood"),
      companions: surveyCount("companions"),
      ticketLikelihood: surveyCount("ticketLikelihood"),
    };

    return res.render("admin", {
      title: "Waitlist dashboard",
      entries,
      storageSource: mongoose.connection.readyState === 1 ? "MongoDB" : "Local JSON",
      notice: ["reminder-sent", "entry-deleted", "tickets-notification-sent:", "tickets-notification-partial:", "survey-reminders-sent:"].some((prefix) =>
        ["reminder-sent", "entry-deleted"].includes(prefix)
          ? req.query.notice === prefix
          : String(req.query.notice || "").startsWith(prefix)
      ) ? String(req.query.notice || "") : "",
      insights,
      stats: {
        signups: entries.length,
        responses: responses.length,
        vipInterest: responses.filter((entry) => ["yes", "maybe"].includes(entry.survey.vipSeating)).length,
        packageInterest: responses.filter((entry) => {
          const snacks = entry.survey.snacks;
          const drinks = entry.survey.drinks;
          return Boolean((Array.isArray(snacks) ? snacks.length : snacks) || (Array.isArray(drinks) ? drinks.length : drinks));
        }).length,
        estimatedAttendance: insights.estimatedAttendance,
        completionRate: insights.completionRate,
      },
    });
  } catch (error) {
    console.error("Admin dashboard failed:", error);
    return res.status(500).send("Unable to load the waitlist dashboard.");
  }
});

app.use("/data", (req, res) => res.sendStatus(404));
app.use(express.static(__dirname));

app.listen(PORT, async () => {
  console.log(`Server running at http://localhost:${PORT}`);
  await connectMongo();
});
