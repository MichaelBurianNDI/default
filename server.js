require("dotenv").config();
const express = require("express");
const multer = require("multer");
const path = require("path");
const cors = require("cors");
const { parsePptx, convertToHtml } = require("./lib/pptxParser");
const { applyEdits } = require("./lib/pptxWriter");
const {
  rewriteText,
  getAvailableStyles,
  isConfigured,
} = require("./lib/llmService");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== ".pptx") {
      return cb(new Error("Only .pptx files are allowed"));
    }
    cb(null, true);
  },
});

// Store parsed presentations in memory (in production, use a database)
const presentations = new Map();

// Upload and convert PowerPoint
app.post("/api/upload", upload.single("presentation"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const presentationId =
      Date.now().toString(36) + Math.random().toString(36).substr(2);
    const slides = await parsePptx(req.file.buffer);
    const html = convertToHtml(slides, presentationId);

    // Store the presentation data and original buffer for later editing/download
    presentations.set(presentationId, {
      slides,
      originalName: req.file.originalname,
      buffer: req.file.buffer,
    });

    res.json({
      success: true,
      presentationId,
      html,
      slideCount: slides.length,
    });
  } catch (error) {
    console.error("Error processing presentation:", error);
    res
      .status(500)
      .json({ error: "Failed to process presentation: " + error.message });
  }
});

// Get presentation data
app.get("/api/presentation/:id", (req, res) => {
  const presentation = presentations.get(req.params.id);
  if (!presentation) {
    return res.status(404).json({ error: "Presentation not found" });
  }
  res.json(presentation);
});

// Get available rewriting styles
app.get("/api/styles", (req, res) => {
  res.json({
    styles: getAvailableStyles(),
    llmConfigured: isConfigured(),
  });
});

// Rewrite text using LLM
app.post("/api/rewrite", async (req, res) => {
  try {
    const { text, prompt, style } = req.body;

    if (!text) {
      return res.status(400).json({ error: "Text is required" });
    }

    if (!prompt && !style) {
      return res
        .status(400)
        .json({ error: "Either prompt or style is required" });
    }

    const rewrittenText = await rewriteText(text, prompt, style);
    res.json({ success: true, rewrittenText });
  } catch (error) {
    console.error("Error rewriting text:", error);
    res.status(500).json({ error: "Failed to rewrite text: " + error.message });
  }
});

// Download modified PPTX
app.post("/api/download/:id", async (req, res) => {
  try {
    const presentation = presentations.get(req.params.id);
    if (!presentation) {
      return res.status(404).json({ error: "Presentation not found" });
    }

    const { edits } = req.body;
    if (!edits || !Array.isArray(edits)) {
      return res.status(400).json({ error: "Edits array is required" });
    }

    const modifiedBuffer = await applyEdits(presentation.buffer, edits);

    const fileName = presentation.originalName.replace(".pptx", "_edited.pptx");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(modifiedBuffer);
  } catch (error) {
    console.error("Error generating download:", error);
    res
      .status(500)
      .json({ error: "Failed to generate download: " + error.message });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

// Serve the main app
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
