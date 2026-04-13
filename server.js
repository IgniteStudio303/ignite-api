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

    // ======================
    // UPLOAD IMAGE
    // ======================

    await R2.send(
      new PutObjectCommand({
        Bucket: BUCKET_NAME,
        Key: key,
        Body: file.buffer,
        ContentType: contentType,
      })
    );

    console.log("IMAGE UPLOADED");

    // ======================
    // BUILD STANDALONE PREVIEW URL (🔥 NEW)
    // ======================

    const previewUrl = `https://ignite-api-1.onrender.com/preview?id=${fileId}&ext=${ext}&name=${encodeURIComponent(name)}&msg=${encodeURIComponent(message)}`;

    // ======================
    // RESPOND IMMEDIATELY
    // ======================

    res.json({
      success: true,
      uploadId: submissionId,
      fileId,
      name,
      message,
      url: previewUrl
    });

    // ======================
    // QR GENERATION (BACKGROUND)
    // ======================

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

        console.log("QR STORED (BACKGROUND)");

      } catch (err) {
        console.error("QR BACKGROUND ERROR:", err.message);
      }
    })();

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});
