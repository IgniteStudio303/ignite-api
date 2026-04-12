require('dotenv').config();
console.log("RUNNING CORRECT SERVER FILE");

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const bodyParser = require("body-parser");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const QRCode = require("qrcode");

const app = express();

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// ======================
// CONFIG
// ======================

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const BUCKET_NAME = process.env.R2_BUCKET || ""; // qrcustomers
const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || "";

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});

// ======================
// ROUTES
// ======================

app.get("/ping", (req, res) => {
  res.send("PING WORKING");
});

// ======================
// UPLOAD ROUTE
// ======================

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    console.log("UPLOAD ROUTE HIT");

    const file = req.file;
    const message = req.body.message || "";
    const name = req.body.name || "pet";
    const variant = req.body.variant || "";

    if (!file) {
      return res.status(400).send("No file uploaded");
    }

    // ======================
    // FILE SETUP
    // ======================

    const ext = file.originalname.split(".").pop().toLowerCase();

    const cleanName = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const submissionId = `sub_${Date.now()}`;
    const fileId = `${submissionId}_${cleanName}`;
    const key = `${fileId}.${ext}`;

    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "mp4"
        ? "video/mp4"
        : "image/jpeg";

    // ======================
    // UPLOAD IMAGE (qrcustomers)
    // ======================

    await R2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME, // ✅ KEEP THIS
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      })
    );

    console.log("IMAGE UPLOADED");

    // ======================
    // QR GENERATION
    // ======================

    const url = `https://ignitestudio.shop/pages/viewer?id=${fileId}&ext=${ext}&variant=${variant}&name=${encodeURIComponent(name)}&msg=${encodeURIComponent(message)}`;

    let qrUrl = null;

    try {
    console.log("GENERATING QR");

const qr = await QRCode.toDataURL(url);

const base64Data = qr.replace(/^data:image\/png;base64,/, "");
const qrBuffer = Buffer.from(base64Data, "base64");

const qrKey = `qr/${fileId}.png`;

console.log("ATTEMPTING QR UPLOAD TO qrcodes");

await R2.send(
  new PutObjectCommand({
    Bucket: "qrcodes", // 🔥 force only this
    Key: qrKey,
    Body: qrBuffer,
    ContentType: "image/png",
  })
);

const qrUrl = `https://pub-676d7b5d3431443084db6a06b3ce26e3.r2.dev/${qrKey}`;

console.log("QR SUCCESSFULLY STORED IN qrcodes");
      console.log("QR UPLOADED TO qrcodes");

    } catch (err) {
      console.error("QR FAILED — FALLING BACK:", err.message);

      // fallback: store QR in main bucket so system doesn't break
      try {
        const qr = await QRCode.toDataURL(url);
        const base64Data = qr.replace(/^data:image\/png;base64,/, "");
        const qrBuffer = Buffer.from(base64Data, "base64");

        const qrKey = `qr/${fileId}.png`;

        await R2.send(
          new PutObjectCommand({
            Bucket: BUCKET_NAME,
            Key: qrKey,
            Body: qrBuffer,
            ContentType: "image/png",
          })
        );

        qrUrl = `https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/${qrKey}`;

        console.log("QR STORED IN FALLBACK (qrcustomers)");

      } catch (fallbackErr) {
        console.error("QR FALLBACK FAILED:", fallbackErr.message);
      }
    }

    // ======================
    // RESPONSE
    // ======================

    res.json({
      success: true,
      uploadId: submissionId,
      fileId,
      variant,
      message,
      name,
      qrUrl,
    });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

// ======================
// START SERVER
// ======================

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
