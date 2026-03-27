const express = require("express");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 5051);
const UPLOAD_DIR = path.join(__dirname, "uploads");

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function sanitizeFileName(fileName) {
  return path
    .basename(fileName || "upload.bin")
    .replace(/[^a-zA-Z0-9._-]/g, "_");
}

function buildAvailableFileName(fileName) {
  const safeName = sanitizeFileName(fileName);
  const parsedPath = path.parse(safeName);
  let candidateName = safeName;
  let counter = 1;

  while (fs.existsSync(path.join(UPLOAD_DIR, candidateName))) {
    candidateName = `${parsedPath.name} (${counter})${parsedPath.ext}`;
    counter += 1;
  }

  return candidateName;
}

const storage = multer.diskStorage({
  destination(_req, _file, cb) {
    cb(null, UPLOAD_DIR);
  },
  filename(_req, file, cb) {
    cb(null, buildAvailableFileName(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOAD_DIR));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    message: "Upload test server is running.",
    uploadDir: UPLOAD_DIR
  });
});

app.post("/upload", upload.single("file"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      ok: false,
      error: "No file received under field 'file'."
    });
  }

  const responsePayload = {
    ok: true,
    message: "File received and saved.",
    fields: req.body || {},
    file: {
      originalName: req.file.originalname,
      savedAs: req.file.filename,
      mimeType: req.file.mimetype,
      size: req.file.size,
      path: req.file.path,
      url: `/uploads/${req.file.filename}`
    }
  };

  console.log("[Upload Test Server] Received upload:\n" + JSON.stringify(responsePayload, null, 2));
  return res.json(responsePayload);
});

app.use((error, _req, res, _next) => {
  console.error("[Upload Test Server] Request failed:", error);
  res.status(500).json({
    ok: false,
    error: error.message || "Unexpected server error."
  });
});

app.listen(PORT, () => {
  console.log(`[Upload Test Server] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[Upload Test Server] Saving uploads to ${UPLOAD_DIR}`);
});
