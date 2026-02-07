const JSZip = require("jszip");
const xml2js = require("xml2js");

/**
 * Apply text edits to a PPTX buffer and return the modified buffer.
 * @param {Buffer} originalBuffer - The original PPTX file buffer
 * @param {Array} edits - Array of { slideIndex, elementId, newText }
 * @returns {Promise<Buffer>} - Modified PPTX buffer
 */
async function applyEdits(originalBuffer, edits) {
  const zip = await JSZip.loadAsync(originalBuffer);
  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
  });
  const builder = new xml2js.Builder({
    headless: true,
    renderOpts: { pretty: false },
  });

  // Get presentation.xml to find slide order
  const presentationXml = await zip
    .file("ppt/presentation.xml")
    ?.async("string");
  if (!presentationXml) throw new Error("Invalid PPTX file");

  const presentationData = await parser.parseStringPromise(presentationXml);
  const sldIdLst =
    presentationData["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"];
  const sldIds = Array.isArray(sldIdLst)
    ? sldIdLst
    : sldIdLst
      ? [sldIdLst]
      : [];

  // Resolve slide paths from presentation rels
  const presRelsXml = await zip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  const presRels = await parser.parseStringPromise(presRelsXml);
  const rels = presRels["Relationships"]?.["Relationship"];
  const relArray = Array.isArray(rels) ? rels : rels ? [rels] : [];

  const slideFiles = [];
  for (const sldId of sldIds) {
    const rId = sldId["$"]?.["r:id"];
    const rel = relArray.find((r) => r["$"]?.Id === rId);
    if (rel) {
      slideFiles.push(`ppt/${rel["$"].Target}`);
    }
  }

  // Group edits by slide index
  const editsBySlide = {};
  for (const edit of edits) {
    if (!editsBySlide[edit.slideIndex]) editsBySlide[edit.slideIndex] = [];
    editsBySlide[edit.slideIndex].push(edit);
  }

  for (const [slideIdxStr, slideEdits] of Object.entries(editsBySlide)) {
    const slideIdx = parseInt(slideIdxStr);
    const slidePath = slideFiles[slideIdx];
    if (!slidePath) continue;

    const slideXml = await zip.file(slidePath)?.async("string");
    if (!slideXml) continue;

    // We work with raw XML string replacement to preserve all formatting.
    // Parse to find shape text, then do targeted replacement.
    const slideData = await parser.parseStringPromise(slideXml);
    const spTree = slideData["p:sld"]?.["p:cSld"]?.["p:spTree"];
    if (!spTree) continue;

    const shapes = spTree["p:sp"];
    const shapeArray = Array.isArray(shapes) ? shapes : shapes ? [shapes] : [];

    for (const edit of slideEdits) {
      // Use shapeIdx if provided, otherwise extract from elementId
      let shapeIdx = edit.shapeIdx;
      if (shapeIdx === undefined || shapeIdx === null) {
        const shapeMatch = edit.elementId.match(/slide\d+-shape(\d+)/);
        if (!shapeMatch) continue;
        shapeIdx = parseInt(shapeMatch[1]);
      }
      if (shapeIdx >= shapeArray.length) continue;

      const shape = shapeArray[shapeIdx];
      const txBody = shape["p:txBody"];
      if (!txBody) continue;

      // Replace text in runs while preserving formatting
      replaceTextInTxBody(txBody, edit.newText);
    }

    // Rebuild XML
    const newSlideXml = builder.buildObject(slideData);
    zip.file(slidePath, newSlideXml);
  }

  return zip.generateAsync({ type: "nodebuffer" });
}

/**
 * Replace text content in a txBody while preserving run formatting.
 * Strategy: put all new text into the first run of the first paragraph,
 * split by newlines into separate paragraphs, clear remaining runs.
 */
function replaceTextInTxBody(txBody, newText) {
  const paragraphs = txBody["a:p"];
  const pArray = Array.isArray(paragraphs)
    ? paragraphs
    : paragraphs
      ? [paragraphs]
      : [];
  if (pArray.length === 0) return;

  const newLines = newText.split("\n");

  // For each new line, reuse an existing paragraph if available, otherwise clone the first
  const newParagraphs = newLines.map((line, i) => {
    // Reuse existing paragraph structure to preserve formatting
    const sourcePara = pArray[Math.min(i, pArray.length - 1)];

    // Deep clone the source paragraph
    const newPara = JSON.parse(JSON.stringify(sourcePara));

    // Get or create runs
    let runs = newPara["a:r"];
    const rArray = Array.isArray(runs) ? runs : runs ? [runs] : [];

    if (rArray.length > 0) {
      // Put all text in the first run, clear the rest
      rArray[0]["a:t"] = line;
      if (rArray.length > 1) {
        // Keep only the first run
        newPara["a:r"] = rArray[0];
      }
    } else {
      // No runs — create one with the text
      newPara["a:r"] = { "a:t": line };
    }

    return newPara;
  });

  // Replace paragraphs
  if (newParagraphs.length === 1) {
    txBody["a:p"] = newParagraphs[0];
  } else {
    txBody["a:p"] = newParagraphs;
  }
}

module.exports = { applyEdits };
