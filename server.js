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
// PREVIEW ROUTE (standalone window)
// ======================

app.get("/preview", (req, res) => {
  try {
    const id = req.query.id || "";
    let ext = req.query.ext || "png";
    const name = decodeURIComponent(req.query.name || "");
    const msg = decodeURIComponent(req.query.msg || "");

    ext = String(ext).toLowerCase();

    const fileUrl = `https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/${id}.${ext}`;
    const isVideo = ext === "mp4";

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <title>Preview</title>
        <link rel="preload" as="image" href="${fileUrl}">
        <style>
          body {
            margin:0;
            padding:30px;
            background:#111;
            color:#fff;
            font-family:Arial, sans-serif;
            text-align:center;
          }
          .wrap {
            max-width:700px;
            margin:auto;
          }
          h1 {
            margin-bottom:20px;
            font-size:28px;
          }
          img, video {
            max-width:100%;
            border-radius:12px;
          }
          .msg {
            margin-top:20px;
            font-size:18px;
            font-style:italic;
          }
          .note {
            margin-top:30px;
            font-size:14px;
            color:#bbb;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          ${name ? `<h1>${name}</h1>` : ""}
          ${
            isVideo
              ? `<video controls autoplay muted><source src="${fileUrl}" type="video/mp4"></video>`
              : `<img src="${fileUrl}" style="opacity:0;transition:opacity 0.3s;" onload="this.style.opacity=1" />`
          }
          ${msg ? `<div class="msg">${msg}</div>` : ""}
          <div class="note">You can close this window to return.</div>
        </div>
      </body>
      </html>
    `);

  } catch (err) {
    console.error("PREVIEW ERROR:", err);
    res.status(500).send("Preview error");
  }
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

    if (!file) {
      return res.status(400).send("No file uploaded");
    }

    let ext = file.originalname.split(".").pop();
    if (!ext) ext = "png";
    ext = ext.toLowerCase();

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

    // Upload image
    await R2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      })
    );

    console.log("IMAGE UPLOADED");

    // Build preview URL (standalone)
    const previewUrl = `https://ignite-api-1.onrender.com/preview?id=${fileId}&ext=${ext}&name=${encodeURIComponent(name)}&msg=${encodeURIComponent(message)}`;

    // Respond immediately (fast)
    res.json({
      success: true,
      uploadId: submissionId,
      fileId,
      name,
      message,
      url: previewUrl
    });

    // Background QR generation
    (async () => {
      try {
        console.log("GENERATING QR IN BACKGROUND");

        const qr = await QRCode.toDataURL(previewUrl);
        const base64Data = qr.replace(/^data:image\/png;base64,/, "");
        const qrBuffer = Buffer.from(base64Data, "base64");

        const qrKey = `qr/${fileId}.png`;

        await R2.send(
          new PutObjectCommand({
            Bucket: "qrcodes",
            Key: qrKey,
            Body: qrBuffer,
            ContentType: "image/png",
          })
        );

        console.log("QR STORED");
      } catch (err) {
        console.error("QR ERROR:", err.message);
      }
    })();

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
