console.log("RUNNING CORRECT SERVER FILE");
const express = require("express");
const multer = require("multer");
const cors = require("cors");
const bodyParser = require("body-parser");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const QRCode = require("qrcode");

const app = express();
app.use(cors({
  origin: "*"
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// ======================
// CONFIG
// ======================

const ACCOUNT_ID = "YOUR_ACCOUNT_ID"; // not used but fine to keep
const BUCKET_NAME = "qrcustomers";

const ACCESS_KEY = process.env.ACCESS_KEY || "";
const SECRET_KEY = process.env.SECRET_KEY || "";

const R2 = new S3Client({
  region: "auto",
  endpoint: "https://45fd60aef9d00d71655dbf7349197c8c.r2.cloudflarestorage.com",
  forcePathStyle: true,
  credentials: {
    accessKeyId: ACCESS_KEY,
    secretAccessKey: SECRET_KEY,
  },
});


// ======================
// TEST ROUTE
// ======================

app.get("/test-r2", async (req, res) => {
  try {
    await R2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: "test.txt",
        Body: "hello world",
        ContentType: "text/plain",
      })
    );

    res.send("R2 upload success");
  } catch (err) {
    console.error("R2 TEST ERROR:", err);
    res.status(500).json(err);
  }
});

// ======================
// UPLOAD ROUTE
// ======================

app.post("/upload", (req, res) => {
  console.log("UPLOAD HIT - CLEAN");
  res.json({ success: true });
});
 
 
  try {

     if (!ACCESS_KEY || !SECRET_KEY) {
      console.error("Missing R2 credentials");
      return res.status(500).send("Missing R2 credentials");
    }

    console.log("Upload route hit");

    const file = req.file;
    const name = req.body.name || "Friend";
    const msg = req.body.msg || "";

    if (!file) {
      return res.status(400).send("No file uploaded");
    }

    console.log("File received:", {
      name: file.originalname,
      size: file.size,
    });

    // 🔹 Get extension
    const ext = file.originalname.split(".").pop().toLowerCase();

    // 🔹 Clean name
    const cleanName = name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");

    // 🔹 Build IDs
    const submissionId = `sub_${Math.floor(Date.now() / 1000)}`;
    const fileId = `${submissionId}_${cleanName}`;
    const key = `${fileId}.${ext}`;

    // 🔹 Content type
    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "mp4"
        ? "video/mp4"
        : "image/jpeg";

    console.log("Uploading to R2...");
    console.log("R2 KEY:", key);

    // 🔹 Upload to R2
    await R2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      })
    );

    console.log("Upload success");

    // 🔹 Build viewer URL (WITH ext — critical)
    const url = `https://ignitestudio.shop/pages/viewer?id=${fileId}&ext=${ext}&name=${encodeURIComponent(
      name
    )}&msg=${encodeURIComponent(msg)}`;

    // 🔹 Generate QR
    const qr = await QRCode.toDataURL(url);
    // ======================
    // SAVE QR TO R2
    // ======================

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

    const qrUrl = `https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/${qrKey}`;
    res.json({
      success: true,
      url,
      qrUrl,
    });
  } catch (err) {
    console.error("UPLOAD ERROR FULL:", err);

    res.status(500).json({
      message: err.message,
      stack: err.stack,
    });
  }


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