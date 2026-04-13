require('dotenv').config();

const express = require("express");
const multer = require("multer");
const cors = require("cors");
const bodyParser = require("body-parser");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const QRCode = require("qrcode");
const { Parser } = require("json2csv");
const { Pool } = require("pg");

const app = express();

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

const upload = multer({ storage: multer.memoryStorage() });

// ======================
// DATABASE (POSTGRES)
// ======================

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

pool.query(`
CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  file_url TEXT,
  preview_url TEXT,
  qr_url TEXT,
  name TEXT,
  message TEXT,
  status TEXT DEFAULT 'pending',
  variant_id TEXT,
  shopify_order_id TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
`);

// ======================
// R2 CONFIG
// ======================

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

// ======================
// ADMIN API
// ======================

app.get("/admin/uploads", async (req, res) => {
  const result = await pool.query("SELECT * FROM uploads ORDER BY created_at DESC");
  res.json(result.rows);
});

app.post("/admin/update-status", async (req, res) => {
  const { id, status } = req.body;
  await pool.query("UPDATE uploads SET status=$1 WHERE id=$2", [status, id]);
  res.json({ success: true });
});

app.get("/admin/uploads/csv", async (req, res) => {
  const result = await pool.query("SELECT * FROM uploads");
  const parser = new Parser();
  const csv = parser.parse(result.rows);

  res.header("Content-Type", "text/csv");
  res.attachment("uploads.csv");
  res.send(csv);
});

// ======================
// DASHBOARD (CLEAN)
// ======================

app.get("/admin", (req, res) => {
  res.send(`
    <html>
    <body style="background:#111;color:#fff;font-family:Arial;padding:20px;">

      <h2>Uploads Dashboard</h2>

      <input id="search" placeholder="Search name..." style="padding:5px;" />

      <br><br>
      <a href="/admin/uploads/csv">Download CSV</a>

      <table id="table" border="1" cellpadding="6" style="margin-top:20px;width:100%;border-collapse:collapse;"></table>

      <script>
        let allData = [];

        function render(data){
          let html = "<tr><th>Img</th><th>Name</th><th>Message</th><th>Status</th><th>QR</th><th>Date</th></tr>";

          data.forEach(row => {
            html += "<tr>";
            html += "<td><img src='" + row.file_url + "' width='60'/></td>";
            html += "<td>" + row.name + "</td>";
            html += "<td>" + row.message + "</td>";
            html += "<td>";
            html += "<select onchange=\\"updateStatus('" + row.id + "', this.value)\\">";
            html += "<option " + (row.status==='pending'?'selected':'') + ">pending</option>";
            html += "<option " + (row.status==='processing'?'selected':'') + ">processing</option>";
            html += "<option " + (row.status==='completed'?'selected':'') + ">completed</option>";
            html += "</select>";
            html += "</td>";
            html += "<td><a href='" + row.qr_url + "' target='_blank'>QR</a></td>";
            html += "<td>" + row.created_at + "</td>";
            html += "</tr>";
          });

          document.getElementById("table").innerHTML = html;
        }

        function updateStatus(id, status){
          fetch('/admin/update-status', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({id, status})
          });
        }

        fetch('/admin/uploads')
          .then(res => res.json())
          .then(data => {
            allData = data;
            render(data);
          });

        document.getElementById("search").addEventListener("input", function(e){
          const val = e.target.value.toLowerCase();
          const filtered = allData.filter(x => x.name.toLowerCase().includes(val));
          render(filtered);
        });

      </script>

    </body>
    </html>
  `);
});

// ======================
// PREVIEW
// ======================

app.get("/preview", (req, res) => {
  const id = req.query.id;
  const ext = req.query.ext || "png";
  const name = decodeURIComponent(req.query.name || "");
  const msg = decodeURIComponent(req.query.msg || "");

  const fileUrl = "https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/" + id + "." + ext;

  res.send(
    "<body style='background:#111;color:#fff;text-align:center;'>" +
    "<h2>" + name + "</h2>" +
    "<img src='" + fileUrl + "' style='max-width:90%'/>" +
    "<p>" + msg + "</p>" +
    "</body>"
  );
});

// ======================
// UPLOAD
// ======================

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    const name = req.body.name || "pet";
    const message = req.body.message || "";
    const variant_id = req.body.variant || null;

    const ext = file.originalname.split(".").pop() || "png";
    const id = "sub_" + Date.now();

    await R2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: id + "." + ext,
      Body: file.buffer
    }));

    const file_url = "https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/" + id + "." + ext;

    const preview_url =
      "https://ignite-api-1.onrender.com/preview?id=" +
      id +
      "&ext=" +
      ext +
      "&name=" +
      encodeURIComponent(name) +
      "&msg=" +
      encodeURIComponent(message);

    const qrData = await QRCode.toDataURL(preview_url);
    const qrBuffer = Buffer.from(qrData.split(",")[1], "base64");

    const qrKey = "qr/" + id + ".png";

    await R2.send(new PutObjectCommand({
      Bucket: "qrcodes",
      Key: qrKey,
      Body: qrBuffer
    }));

    const qr_url = "https://pub-e0dc729813ef47d698495d0ac6ed4e36.r2.dev/" + qrKey;

    await pool.query(
      "INSERT INTO uploads (id, file_url, preview_url, qr_url, name, message, variant_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [id, file_url, preview_url, qr_url, name, message, variant_id]
    );

    res.json({ success: true, preview_url, qr_url });

  } catch (err) {
    console.error(err);
    res.status(500).send("error");
  }
});

// ======================

app.listen(process.env.PORT || 10000);