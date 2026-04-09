require('dotenv').config();
console.log("R2 CHECK:", process.env.R2_ACCESS_KEY_ID);
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
const BUCKET_NAME = process.env.R2_BUCKET || "";

const ACCESS_KEY = process.env.R2_ACCESS_KEY_ID || "";
const SECRET_KEY = process.env.R2_SECRET_ACCESS_KEY || "";

console.log("R2 DEBUG:", {
  ACCOUNT_ID,
  ACCESS_KEY: ACCESS_KEY ? "OK" : "MISSING",
  SECRET_KEY: SECRET_KEY ? "OK" : "MISSING",
  BUCKET_NAME,
});

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
// TEST ROUTE
// ======================

app.get("/ping", (req, res) => {
  res.send("PING WORKING");
});

// ======================
// UPLOAD ROUTE
// ======================

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    console.log("🔥 UPLOAD ROUTE HIT 🔥");

    if (!ACCESS_KEY || !SECRET_KEY) {
      console.error("Missing R2 credentials");
      return res.status(500).send("Missing R2 credentials");
    }

    const file = req.file;
    console.log("STEP 1: FILE RECEIVED");

    const message = req.body.message || "";
    const name = req.body.name || "Friend";
    const variant = req.body.variant || "";

    if (!file) {
      return res.status(400).send("No file uploaded");
    }

    const ext = file.originalname.split(".").pop().toLowerCase();

    const cleanName = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    const submissionId = `sub_${Math.floor(Date.now() / 1000)}`;
    const fileId = `${submissionId}_${cleanName}`;
    const key = `${fileId}.${ext}`;

    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "mp4"
        ? "video/mp4"
        : "image/jpeg";

    // ======================
    // FILE UPLOAD
    // ======================

    await R2.send(
      new PutObjectCommand({
       Bucket: "qrcodes",
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      })
    );

    console.log("STEP 2: FILE UPLOADED TO R2");

    // ======================
    // QR GENERATION
    // ======================

    console.log("STEP 3: STARTING QR GENERATION");

    const url = `https://ignitestudio.shop/pages/viewer?id=${fileId}&ext=${ext}&variant=${variant}&name=${encodeURIComponent(name)}&msg=${encodeURIComponent(message)}`;

    let qr;
    try {
      qr = await QRCode.toDataURL(url);
      console.log("STEP 4: QR GENERATED");
 catch (err) {
  console.error("QR UPLOAD FAILED FULL:", JSON.stringify(err, null, 2));
}

    if (!qr) {
      console.error("QR IS EMPTY — SKIPPING UPLOAD");
    }

    // ======================
    // QR UPLOAD
    // ======================

    const base64Data = qr.replace(/^data:image\/png;base64,/, "");
    const qrBuffer = Buffer.from(base64Data, "base64");

    const qrKey = `qr/${fileId}.png`;

    try {
      await R2.send(
        new PutObjectCommand({
          Bucket: qrcodes,
          Key: qrKey,
          Body: qrBuffer,
          ContentType: "image/png",
        })
      );

      console.log("STEP 5: QR UPLOADED");
    } catch (err) {
      console.error("QR UPLOAD FAILED:", err);
    }

    const qrUrl = `https://pub-676d7b5d3431443084db6a06b3ce26e3.r2.dev/${qrKey}`;

    // ======================
    // RESPONSE
    // ======================

    const responsePayload = {
      success: true,
      uploadId: submissionId,
      fileId: fileId,
      variant: variant,
      message: message,
      name: name,
      url: `${url}&variant=${variant}&addToCart=true`,
      qrUrl,
    };

    console.log("FINAL RESPONSE PAYLOAD:", responsePayload);

    res.json(responsePayload);

 catch (err) {
  console.error("QR UPLOAD FAILED FULL:", JSON.stringify(err, null, 2));
}

    res.status(500).json({
      message: err.message,
      stack: err.stack,
    });
  }
});

// ======================
// START SERVER
// ======================

const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
  res.send("ROOT WORKING");
});

console.log("PORT VALUE:", process.env.PORT);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
