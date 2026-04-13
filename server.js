require('dotenv').config();
console.log("RUNNING CORRECT SERVER FILE");

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const bodyParser = require("body-parser");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const QRCode = require("qrcode");
const { Parser } = require("json2csv");
const fs = require("fs");

const app = express();

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// ======================
// SIMPLE STORAGE (JSON)
// ======================

const DATA_FILE = "/tmp/uploads.json";

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    return [];
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ======================
// CONFIG
// ======================

const ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const BUCKET_NAME = process.env.R2_BUCKET || "";
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
// BASIC AUTH (ADMIN)
// ======================

app.use("/admin", (req, res, next) => {
  const auth = { login: "admin", password: "ignite123" };

  const b64auth = (req.headers.authorization || "").split(" ")[1] || "";
  const [login, password] = Buffer.from(b64auth, "base64").toString().split(":");

  if (login === auth.login && password === auth.password) {
    return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Admin Area"');
  res.status(401).send("Authentication required.");
});

// ======================
// ROUTES
// ======================

app.get("/ping", (req, res) => {
  res.send("PING WORKING");
});

// ======================
// ADMIN ROUTES
// ======================

app.get("/admin/uploads", (req, res) => {
  const data = loadData();
  res.json(data.reverse());
});

app.get("/admin/uploads/csv", (req, res) => {
  const data = loadData();

  const parser = new Parser();
  const csv = parser.parse(data);

  res.header("Content-Type", "text/csv");
  res.attachment("uploads.csv");
  res.send(csv);
});

app.get("/admin", (req, res) => {
  res.send(`
    <html>
    <head>
      <title>Uploads Dashboard</title>
      <style>
        body { font-family: Arial; padding: 20px; background:#111; color:#fff; }
        table { border-collapse: collapse; width: 100%; }
        th, td { border: 1px solid #444; padding: 8px; }
        img { max-width: 100px; border-radius:6px; }
        a { color:#0af; }
      </style>
    </head>
    <body>
      <h2>Uploads Dashboard</h2>
      <a href="/admin/uploads/csv">Download CSV</a>
      <table id="table"></table>

      <script>
        fetch('/admin/uploads')
          .then(res => res.json())
          .then(data => {
            const table = document.getElementById('table');

            let html = '<tr><th>Preview</th><th>Name</th><th>Message</th><th>Date</th></tr>';

            data.forEach(row => {
              html += \`
                <tr>
                  <td><img src="\${row.file_url}" /></td>
                  <td>\${row.name}</td>
                  <td>\${row.message}</td>
                  <td>\${row.created_at}</td>
                </tr>
              \`;
            });

            table.innerHTML = html;
          });
      </script>
    </body>
    </html>
  `);
});

// ======================
// PREVIEW ROUTE
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
        <style>
          body { margin:0; padding:30px; background:#111; color:#fff; text-align:center; }
          .wrap { max-width:700px; margin:auto; }
          img, video { max-width:100%; border-radius:12px; }
        </style>
      </head>
      <body>
        <div class="wrap">
          ${name ? `<h1>${name}</h1>` : ""}
          ${
            isVideo
              ? `<video controls autoplay muted><source src="${fileUrl}" type="video/mp4"></video>`
              : `<img src="${fileUrl}" />`
          }
          ${msg ? `<div>${msg}</div>` : ""}
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
    const file = req.file;
    const message = req.body.message || "";
    const name = req.body.name || "pet";

    if (!file) {
      return res.status(400).send("No file uploaded");
    }

    let ext = file.originalname.split(".").pop() || "png";
    ext = ext.toLowerCase();

    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, "-");

    const submissionId = `sub_${Date.now()}`;
    const fileId = `${submissionId}_${cleanName}`;
    const key = `${fileId}.${ext}`;

    const contentType =
      ext === "png" ? "image/png" :
      ext === "mp4" ? "video/mp4" :
      "image/jpeg";

    await R2.send(new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: contentType,
    }));

    const fileUrl = `https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/${fileId}.${ext}`;

    const previewUrl = `https://ignite-api-1.onrender.com/preview?id=${fileId}&ext=${ext}&name=${encodeURIComponent(name)}&msg=${encodeURIComponent(message)}`;

    // ✅ SAVE DATA
    const data = loadData();
    data.push({
      id: submissionId,
      file_url: fileUrl,
      name,
      message,
      created_at: new Date().toISOString()
    });
    saveData(data);

    res.json({
      success: true,
      uploadId: submissionId,
      fileId,
      name,
      message,
      url: previewUrl
    });

    // QR BACKGROUND
    (async () => {
      try {
        const qr = await QRCode.toDataURL(previewUrl);
        const base64Data = qr.replace(/^data:image\/png;base64,/, "");
        const qrBuffer = Buffer.from(base64Data, "base64");

        await R2.send(new PutObjectCommand({
          Bucket: "qrcodes",
          Key: `qr/${fileId}.png`,
          Body: qrBuffer,
          ContentType: "image/png",
        }));
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