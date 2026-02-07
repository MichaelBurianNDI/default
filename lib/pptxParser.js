const JSZip = require("jszip");
const xml2js = require("xml2js");

// Module-level resolved theme color map, populated during parsePptx
let resolvedThemeColors = {};

/**
 * Parse a PPTX file buffer and extract slide content
 */
async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = [];

  // Get presentation.xml to understand slide order
  const presentationXml = await zip
    .file("ppt/presentation.xml")
    ?.async("string");
  if (!presentationXml) {
    throw new Error("Invalid PPTX file: missing presentation.xml");
  }

  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: false,
  });
  const presentation = await parser.parseStringPromise(presentationXml);

  // Get slide relationship IDs
  const slideRels = presentation["p:presentation"]?.["p:sldIdLst"]?.["p:sldId"];
  const slideIds = Array.isArray(slideRels)
    ? slideRels
    : slideRels
      ? [slideRels]
      : [];

  // Parse relationships to get slide file names
  const relsXml = await zip
    .file("ppt/_rels/presentation.xml.rels")
    ?.async("string");
  const rels = await parser.parseStringPromise(relsXml);
  const relationships = rels["Relationships"]?.["Relationship"];
  const relArray = Array.isArray(relationships)
    ? relationships
    : relationships
      ? [relationships]
      : [];

  // Create a map of relationship IDs to slide files
  const relMap = new Map();
  relArray.forEach((rel) => {
    if (rel["$"]?.Target?.includes("slide")) {
      relMap.set(rel["$"].Id, rel["$"].Target);
    }
  });

  // Get slide dimensions from presentation
  const sldSz = presentation["p:presentation"]?.["p:sldSz"];
  const slideWidth = sldSz?.["$"]?.cx
    ? (parseInt(sldSz["$"].cx) / 914400) * 96
    : 960; // EMUs to pixels
  const slideHeight = sldSz?.["$"]?.cy
    ? (parseInt(sldSz["$"].cy) / 914400) * 96
    : 540;

  // Parse each slide
  let slideIndex = 0;
  for (const slideId of slideIds) {
    const relId = slideId["$"]?.["r:id"];
    let slideFile = relMap.get(relId);

    if (!slideFile) {
      // Fallback: try to find slide by index
      slideFile = `slides/slide${slideIndex + 1}.xml`;
    }

    const slidePath = `ppt/${slideFile}`;
    const slideXml = await zip.file(slidePath)?.async("string");

    if (slideXml) {
      const slideData = await parser.parseStringPromise(slideXml);

      // Get slide's layout relationship
      const slideRelsPath = `ppt/slides/_rels/${slideFile.split("/").pop()}.rels`;
      const slideRelsXml = await zip.file(slideRelsPath)?.async("string");
      let layoutData = null;
      let masterData = null;
      let themeData = null;
      let slideRelsData = null;

      if (slideRelsXml) {
        slideRelsData = await parser.parseStringPromise(slideRelsXml);
        const slideRelsArray = slideRelsData["Relationships"]?.["Relationship"];
        const slideRelArray = Array.isArray(slideRelsArray)
          ? slideRelsArray
          : slideRelsArray
            ? [slideRelsArray]
            : [];

        // Find layout relationship
        const layoutRel = slideRelArray.find((r) =>
          r["$"]?.Type?.includes("slideLayout"),
        );
        if (layoutRel) {
          const layoutPath = `ppt/${layoutRel["$"].Target.replace("../", "")}`;
          const layoutXml = await zip.file(layoutPath)?.async("string");
          if (layoutXml) {
            layoutData = await parser.parseStringPromise(layoutXml);

            // Get layout's master relationship
            const layoutRelsPath = `ppt/slideLayouts/_rels/${layoutPath.split("/").pop()}.rels`;
            const layoutRelsXml = await zip
              .file(layoutRelsPath)
              ?.async("string");
            if (layoutRelsXml) {
              const layoutRels = await parser.parseStringPromise(layoutRelsXml);
              const layoutRelsArray =
                layoutRels["Relationships"]?.["Relationship"];
              const layoutRelArray = Array.isArray(layoutRelsArray)
                ? layoutRelsArray
                : layoutRelsArray
                  ? [layoutRelsArray]
                  : [];

              // Find master relationship
              const masterRel = layoutRelArray.find((r) =>
                r["$"]?.Type?.includes("slideMaster"),
              );
              if (masterRel) {
                const masterPath = `ppt/${masterRel["$"].Target.replace("../", "")}`;
                const masterXml = await zip.file(masterPath)?.async("string");
                if (masterXml) {
                  masterData = await parser.parseStringPromise(masterXml);

                  // Get theme from master relationship
                  const masterRelsPath = `ppt/slideMasters/_rels/${masterPath.split("/").pop()}.rels`;
                  const masterRelsXml = await zip
                    .file(masterRelsPath)
                    ?.async("string");
                  if (masterRelsXml) {
                    const masterRels =
                      await parser.parseStringPromise(masterRelsXml);
                    const masterRelsArray =
                      masterRels["Relationships"]?.["Relationship"];
                    const masterRelArray = Array.isArray(masterRelsArray)
                      ? masterRelsArray
                      : masterRelsArray
                        ? [masterRelsArray]
                        : [];

                    const themeRel = masterRelArray.find((r) =>
                      r["$"]?.Type?.includes("theme"),
                    );
                    if (themeRel) {
                      const themePath = `ppt/${themeRel["$"].Target.replace("../", "")}`;
                      const themeXml = await zip
                        .file(themePath)
                        ?.async("string");
                      if (themeXml) {
                        themeData = await parser.parseStringPromise(themeXml);
                        // Extract actual theme colors
                        resolvedThemeColors = extractThemeColorMap(themeData);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      const slideElements = await extractSlideElements(
        slideData,
        slideWidth,
        slideHeight,
        slideIndex,
        false, // isMaster
        masterData,
        themeData,
        zip,
        slideRelsData,
        slideXml,
      );

      // Extract elements from slide master (background shapes, logos, etc.)
      let masterElements = [];
      if (masterData) {
        masterElements = await extractSlideElements(
          masterData,
          slideWidth,
          slideHeight,
          slideIndex,
          true, // isMaster
          masterData,
          themeData,
        );
        // Mark master elements
        masterElements.forEach((el) => {
          el.isMaster = true;
          el.id = `slide${slideIndex}-master-${el.id}`;
        });
      }

      // Merge: master elements first (behind), then slide elements (on top)
      const elements = [...masterElements, ...slideElements];

      // Get slide background with inheritance from layout/master
      const background = extractBackground(slideData, layoutData, masterData);

      slides.push({
        index: slideIndex,
        width: slideWidth,
        height: slideHeight,
        elements,
        background,
      });
    }
    slideIndex++;
  }

  // If no slides found through relationships, try direct file access
  if (slides.length === 0) {
    const slideFiles = Object.keys(zip.files).filter((f) =>
      f.match(/ppt\/slides\/slide\d+\.xml$/),
    );
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1]);
      const numB = parseInt(b.match(/slide(\d+)/)[1]);
      return numA - numB;
    });

    for (let i = 0; i < slideFiles.length; i++) {
      const slideXml = await zip.file(slideFiles[i])?.async("string");
      if (slideXml) {
        const slideData = await parser.parseStringPromise(slideXml);
        const elements = await extractSlideElements(
          slideData,
          slideWidth,
          slideHeight,
          i,
          false, // isMaster
          null, // masterData
          null, // themeData
          null, // zip
          null, // slideRelsData
          slideXml,
        );
        const background = extractBackground(slideData, null, null);

        slides.push({
          index: i,
          width: slideWidth,
          height: slideHeight,
          elements,
          background,
        });
      }
    }
  }

  return slides;
}

/**
 * Extract background color from slide, layout, or master
 */
function extractBackground(slideData, layoutData, masterData, themeData) {
  // Try slide background first
  const slideBg = extractBackgroundFromNode(
    slideData["p:sld"]?.["p:cSld"]?.["p:bg"],
  );
  if (slideBg) return slideBg;

  // Try layout background
  const layoutBg = extractBackgroundFromNode(
    layoutData?.["p:sldLayout"]?.["p:cSld"]?.["p:bg"],
  );
  if (layoutBg) return layoutBg;

  // Try master background
  const masterBg = extractBackgroundFromNode(
    masterData?.["p:sldMaster"]?.["p:cSld"]?.["p:bg"],
  );
  if (masterBg) return masterBg;

  // Default to white
  return "#ffffff";
}

/**
 * Extract background color from a bg node
 */
function extractBackgroundFromNode(bg) {
  if (!bg) return null;

  const bgPr = bg["p:bgPr"];
  if (bgPr) {
    // Solid fill
    const solidFill = bgPr["a:solidFill"];
    if (solidFill) {
      // sRGB color
      const srgbClr = solidFill["a:srgbClr"]?.["$"]?.val;
      if (srgbClr) {
        return `#${srgbClr}`;
      }
      // Theme color
      const schemeClr = solidFill["a:schemeClr"]?.["$"]?.val;
      if (schemeClr) {
        return getThemeColor(schemeClr);
      }
    }

    // Gradient fill
    const gradFill = bgPr["a:gradFill"];
    if (gradFill) {
      const gsLst = gradFill["a:gsLst"]?.["a:gs"];
      if (gsLst) {
        const firstStop = Array.isArray(gsLst) ? gsLst[0] : gsLst;
        const srgbClr = firstStop?.["a:srgbClr"]?.["$"]?.val;
        const schemeClr = firstStop?.["a:schemeClr"]?.["$"]?.val;
        if (srgbClr) return `#${srgbClr}`;
        if (schemeClr) return getThemeColor(schemeClr);
      }
    }
  }

  return null;
}

/**
 * Determine the interleaved order of p:sp, p:pic, p:grpSp within spTree from raw XML.
 * Returns an array of { tag, typeIdx } in document order.
 */
function getSpTreeChildOrder(slideXml) {
  if (!slideXml) return null;

  const spTreeStart = slideXml.indexOf("<p:spTree>");
  const spTreeEnd = slideXml.indexOf("</p:spTree>");
  if (spTreeStart === -1 || spTreeEnd === -1) return null;

  const spTreeXml = slideXml.substring(spTreeStart, spTreeEnd);
  const tagRegex = /<(\/?)(p:sp|p:pic|p:grpSp)([\s>\/])/g;
  let m;
  let depth = 0;
  let spIdx = 0,
    picIdx = 0,
    grpIdx = 0;
  const order = [];

  while ((m = tagRegex.exec(spTreeXml)) !== null) {
    const isClosing = m[1] === "/";
    const tag = m[2];

    if (isClosing) {
      depth--;
    } else {
      if (depth === 0) {
        let typeIdx;
        if (tag === "p:sp") typeIdx = spIdx++;
        else if (tag === "p:pic") typeIdx = picIdx++;
        else if (tag === "p:grpSp") typeIdx = grpIdx++;
        order.push({ tag, typeIdx });
      }
      const isSelfClosing = m[3] === "/";
      if (!isSelfClosing) depth++;
    }
  }

  return order;
}

/**
 * Extract elements (text boxes, shapes) from a slide or master
 */
async function extractSlideElements(
  slideData,
  slideWidth,
  slideHeight,
  slideIndex,
  isMaster = false,
  masterData = null,
  themeData = null,
  zip = null,
  slideRelsData = null,
  slideXml = null,
) {
  const elements = [];
  const cSld =
    slideData["p:sld"]?.["p:cSld"] || slideData["p:sldMaster"]?.["p:cSld"];
  const spTree = cSld?.["p:spTree"];

  if (!spTree) return elements;

  const shapes = spTree["p:sp"];
  const shapeArray = Array.isArray(shapes) ? shapes : shapes ? [shapes] : [];

  const pics = spTree["p:pic"];
  const picArray = Array.isArray(pics) ? pics : pics ? [pics] : [];

  // Determine document order of elements
  const childOrder = getSpTreeChildOrder(slideXml);

  let elementIdx = 0;

  if (childOrder && childOrder.length > 0) {
    // Process in document order
    for (const entry of childOrder) {
      if (entry.tag === "p:sp" && entry.typeIdx < shapeArray.length) {
        const element = extractShapeElement(
          shapeArray[entry.typeIdx],
          slideWidth,
          slideHeight,
          slideIndex,
          elementIdx,
          isMaster,
          masterData,
          themeData,
        );
        if (element) {
          element.shapeIdx = entry.typeIdx;
          elements.push(element);
          elementIdx++;
        }
      } else if (entry.tag === "p:pic" && entry.typeIdx < picArray.length) {
        const element = await extractPicElement(
          picArray[entry.typeIdx],
          slideWidth,
          slideHeight,
          slideIndex,
          elementIdx,
          zip,
          slideRelsData,
        );
        if (element) {
          elements.push(element);
          elementIdx++;
        }
      }
    }
  } else {
    // Fallback: shapes then pics (no raw XML available)
    shapeArray.forEach((shape, idx) => {
      const element = extractShapeElement(
        shape,
        slideWidth,
        slideHeight,
        slideIndex,
        elementIdx,
        isMaster,
        masterData,
        themeData,
      );
      if (element) {
        element.shapeIdx = idx;
        elements.push(element);
        elementIdx++;
      }
    });

    for (let idx = 0; idx < picArray.length; idx++) {
      const element = await extractPicElement(
        picArray[idx],
        slideWidth,
        slideHeight,
        slideIndex,
        elementIdx,
        zip,
        slideRelsData,
      );
      if (element) {
        elements.push(element);
        elementIdx++;
      }
    }
  }

  return elements;
}

/**
 * Extract a single shape element
 */
function extractShapeElement(
  shape,
  slideWidth,
  slideHeight,
  slideIndex,
  shapeIndex,
  isMaster = false,
  masterData = null,
  themeData = null,
) {
  const spPr = shape["p:spPr"];
  const txBody = shape["p:txBody"];
  const nvSpPr = shape["p:nvSpPr"];

  // Get placeholder type (title, body, etc.) - master placeholders usually have showMasterPh
  const phType = nvSpPr?.["p:nvPr"]?.["p:ph"]?.["$"]?.type;
  const phShow = nvSpPr?.["p:nvPr"]?.["p:ph"]?.["$"]?.showMasterPh;

  // Skip master placeholders that are hidden on slides (unless we're extracting the master itself)
  if (phShow === "0" && !isMaster) {
    return null;
  }

  // Get position and size
  const xfrm = spPr?.["a:xfrm"];
  const off = xfrm?.["a:off"]?.["$"];
  const ext = xfrm?.["a:ext"]?.["$"];
  const rot = xfrm?.["$"]?.rot;

  // Convert EMUs to pixels (914400 EMUs = 1 inch, assume 96 DPI)
  const emuToPixel = (emu) => (emu ? (parseInt(emu) / 914400) * 96 : 0);

  const x = emuToPixel(off?.x);
  const y = emuToPixel(off?.y);
  const width = emuToPixel(ext?.cx);
  const height = emuToPixel(ext?.cy);

  // Extract rotation (in 60000ths of a degree)
  const rotation = rot ? parseInt(rot) / 60000 : 0;

  // Extract text content
  const textContent = extractTextContent(txBody);

  // Get shape fill color
  const fillColor = extractFillColor(spPr);

  // Get shape outline
  const outline = extractOutline(spPr);

  // Extract body properties (anchor, insets, wrap, autofit)
  const bodyProps = extractBodyProperties(txBody?.["a:bodyPr"]);

  // Check if shape has geometry (prstGeom or custGeom)
  const hasShape = !!spPr?.["a:prstGeom"] || !!spPr?.["a:custGeom"];

  const hasFill = fillColor && fillColor !== "none";

  // Keep master elements that have shapes even without fill/text
  if (!textContent && !hasFill && !outline && !(isMaster && hasShape)) {
    return null;
  }

  return {
    id: `slide${slideIndex}-shape${shapeIndex}`,
    type: "textbox",
    x: x,
    y: y,
    width: width || 200,
    height: height || 50,
    text: textContent,
    paragraphs: extractParagraphs(txBody, phType, masterData, themeData),
    fillColor,
    outline,
    hasShape,
    rotation,
    bodyProps,
    styles: extractTextStyles(txBody, phType, masterData, themeData),
  };
}

/**
 * Extract a picture element (p:pic)
 */
async function extractPicElement(
  pic,
  slideWidth,
  slideHeight,
  slideIndex,
  shapeIndex,
  zip,
  slideRelsData,
) {
  const spPr = pic["p:spPr"];
  const blipFill = pic["p:blipFill"];

  if (!blipFill) return null;

  // Get embed relationship ID
  const embedId = blipFill["a:blip"]?.["$"]?.["r:embed"];
  if (!embedId || !slideRelsData || !zip) return null;

  // Resolve image path from relationships
  const rels = slideRelsData["Relationships"]?.["Relationship"];
  const relArray = Array.isArray(rels) ? rels : rels ? [rels] : [];
  const imageRel = relArray.find((r) => r["$"]?.Id === embedId);
  if (!imageRel) return null;

  const imagePath = `ppt/${imageRel["$"].Target.replace("../", "")}`;

  // Get position and size
  const xfrm = spPr?.["a:xfrm"];
  const off = xfrm?.["a:off"]?.["$"];
  const ext = xfrm?.["a:ext"]?.["$"];
  const rot = xfrm?.["$"]?.rot;

  const emuToPixel = (emu) => (emu ? (parseInt(emu) / 914400) * 96 : 0);

  const x = emuToPixel(off?.x);
  const y = emuToPixel(off?.y);
  const width = emuToPixel(ext?.cx);
  const height = emuToPixel(ext?.cy);
  const rotation = rot ? parseInt(rot) / 60000 : 0;

  // Read image data as base64
  let imageData = null;
  try {
    const imageFile = zip.file(imagePath);
    if (imageFile) {
      const imageBuffer = await imageFile.async("base64");
      const ext = imagePath.split(".").pop().toLowerCase();
      const mimeMap = {
        png: "image/png",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        gif: "image/gif",
        svg: "image/svg+xml",
        emf: "image/emf",
        wmf: "image/wmf",
        bmp: "image/bmp",
        tiff: "image/tiff",
      };
      const mime = mimeMap[ext] || "image/png";
      imageData = `data:${mime};base64,${imageBuffer}`;
    }
  } catch (e) {
    // Skip images that can't be read
  }

  if (!imageData) return null;

  return {
    id: `slide${slideIndex}-pic${shapeIndex}`,
    type: "image",
    x,
    y,
    width: width || 200,
    height: height || 200,
    imageData,
    rotation,
  };
}

/**
 * Extract body properties (anchor, insets, wrap, autofit)
 */
function extractBodyProperties(bodyPr) {
  if (!bodyPr) return null;

  const attrs = bodyPr["$"] || {};

  // Convert EMUs to points (914400 EMUs = 1 inch, 72 points per inch)
  const emuToPoints = (emu) => (emu ? (parseInt(emu) / 914400) * 72 : 0);

  return {
    // Vertical alignment: t=top, b=bottom, ctr=center
    anchor: attrs.anchor || "t",
    anchorCtr: attrs.anchorCtr === "1",

    // Text wrapping: square, none
    wrap: attrs.wrap || "square",

    // Insets (left, top, right, bottom) in points
    leftInset: emuToPoints(attrs.lIns),
    topInset: emuToPoints(attrs.tIns),
    rightInset: emuToPoints(attrs.rIns),
    bottomInset: emuToPoints(attrs.bIns),

    // Text fitting
    fit: bodyPr["a:normAutofit"]
      ? "normAutofit"
      : bodyPr["a:spAutoFit"]
        ? "spAutoFit"
        : null,
    fontScale: bodyPr["a:normAutofit"]?.["$"]?.fontScale,
    lnSpcReduction: bodyPr["a:normAutofit"]?.["$"]?.lnSpcReduction,
  };
}
function extractTextContent(txBody) {
  if (!txBody) return "";

  const paragraphs = txBody["a:p"];
  const pArray = Array.isArray(paragraphs)
    ? paragraphs
    : paragraphs
      ? [paragraphs]
      : [];

  const textParts = [];
  pArray.forEach((p) => {
    const runs = p["a:r"];
    const rArray = Array.isArray(runs) ? runs : runs ? [runs] : [];

    const paragraphText = rArray
      .map((r) => {
        const t = r["a:t"];
        if (typeof t === "string") return t;
        if (typeof t === "object" && t._) return t._;
        return "";
      })
      .join("");

    // Also check for field text (like page numbers)
    const fld = p["a:fld"];
    if (fld) {
      const fldArray = Array.isArray(fld) ? fld : [fld];
      fldArray.forEach((f) => {
        const t = f["a:t"];
        if (typeof t === "string") textParts.push(t);
      });
    }

    if (paragraphText) {
      textParts.push(paragraphText);
    }
  });

  return textParts.join("\n");
}

/**
 * Extract structured paragraph and run data from txBody
 */
function extractParagraphs(txBody, phType, masterData, themeData) {
  if (!txBody) return [];

  // Resolve default font from theme
  let defaultFontFamily = "Arial";
  if (themeData) {
    const fontScheme =
      themeData["a:theme"]?.["a:themeElements"]?.["a:fontScheme"];
    if (fontScheme) {
      if (phType === "title" || phType === "ctrTitle") {
        const majorFont =
          fontScheme["a:majorFont"]?.["a:latin"]?.["$"]?.typeface;
        if (majorFont) defaultFontFamily = majorFont;
      } else {
        const minorFont =
          fontScheme["a:minorFont"]?.["a:latin"]?.["$"]?.typeface;
        if (minorFont) defaultFontFamily = minorFont;
      }
    }
  }
  if (defaultFontFamily === "Arial" && masterData) {
    const txStyles = masterData["p:sldMaster"]?.["p:txStyles"];
    if (txStyles) {
      const defRPr =
        txStyles["p:titleStyle"]?.["a:defRPr"] ||
        txStyles["p:otherStyle"]?.["a:defRPr"];
      const latinFont = defRPr?.["a:latin"]?.["$"]?.typeface;
      if (latinFont) defaultFontFamily = latinFont;
    }
  }

  let defaultFontSize = 18;
  if (phType === "title" || phType === "ctrTitle") defaultFontSize = 44;
  else if (phType === "subTitle") defaultFontSize = 32;

  const paragraphs = txBody["a:p"];
  const pArray = Array.isArray(paragraphs)
    ? paragraphs
    : paragraphs
      ? [paragraphs]
      : [];

  const lstStyle = txBody["a:lstStyle"];

  return pArray.map((p) => {
    const pPr = p["a:pPr"];
    const pAttrs = pPr?.["$"] || {};
    const lvl = parseInt(pAttrs.lvl || "0");

    // Paragraph-level defaults from lstStyle
    let pDefaults = {
      fontSize: defaultFontSize,
      fontFamily: defaultFontFamily,
      color: "#000000",
      bold: false,
      italic: false,
    };
    if (lstStyle) {
      const lvlPr = lstStyle[`a:lvl${lvl + 1}pPr`];
      if (lvlPr?.["a:defRPr"]) {
        applyRunProperties(pDefaults, lvlPr["a:defRPr"]);
      }
    }
    // Paragraph-level defRPr overrides
    if (pPr?.["a:defRPr"]) {
      applyRunProperties(pDefaults, pPr["a:defRPr"]);
    }

    // Alignment
    let align = "left";
    if (pAttrs.algn === "ctr") align = "center";
    else if (pAttrs.algn === "r") align = "right";
    else if (pAttrs.algn === "just") align = "justify";

    // Spacing
    const spcBef = pPr?.["a:spcBef"]?.["a:spcPts"]?.["$"]?.val;
    const spcAft = pPr?.["a:spcAft"]?.["a:spcPts"]?.["$"]?.val;

    // Indentation
    const leftMargin = pAttrs.marL ? (parseInt(pAttrs.marL) / 914400) * 96 : 0;
    const indent = pAttrs.indent ? (parseInt(pAttrs.indent) / 914400) * 96 : 0;

    // Bullet
    let bulletChar = null;
    if (pPr?.["a:buChar"]) {
      bulletChar = pPr["a:buChar"]["$"]?.char || null;
    } else if (pPr?.["a:buAutoNum"]) {
      bulletChar = "•"; // fallback for auto-numbered
    }
    const hasBuNone = !!pPr?.["a:buNone"];

    // Extract runs
    const runs = p["a:r"];
    const rArray = Array.isArray(runs) ? runs : runs ? [runs] : [];

    const extractedRuns = rArray.map((r) => {
      const t = r["a:t"];
      const text = typeof t === "string" ? t : t?._ || "";
      const rPr = r["a:rPr"];

      // Start with paragraph defaults, then override with run properties
      const runStyle = { ...pDefaults };
      if (rPr) {
        applyRunProperties(runStyle, rPr);
      }

      return { text, style: runStyle };
    });

    // Also check for field text (like page numbers)
    const fld = p["a:fld"];
    if (fld) {
      const fldArray = Array.isArray(fld) ? fld : [fld];
      fldArray.forEach((f) => {
        const t = f["a:t"];
        const text = typeof t === "string" ? t : "";
        const rPr = f["a:rPr"];
        const runStyle = { ...pDefaults };
        if (rPr) applyRunProperties(runStyle, rPr);
        extractedRuns.push({ text, style: runStyle });
      });
    }

    return {
      runs: extractedRuns,
      align,
      spaceBefore: spcBef ? parseInt(spcBef) / 100 : 0,
      spaceAfter: spcAft ? parseInt(spcAft) / 100 : 0,
      leftMargin,
      indent,
      bulletChar: hasBuNone ? null : bulletChar,
      rtl: pAttrs.rtl === "1",
      defaults: pDefaults,
    };
  });
}

/**
 * Extract text styles from txBody (legacy — used for element-level defaults)
 */
function extractTextStyles(txBody, phType, masterData, themeData) {
  if (!txBody) return {};

  let defaultFontSize = 18;
  if (phType === "title" || phType === "ctrTitle") defaultFontSize = 44;
  else if (phType === "subTitle") defaultFontSize = 32;

  let defaultFontFamily = "Arial";
  if (themeData) {
    const fontScheme =
      themeData["a:theme"]?.["a:themeElements"]?.["a:fontScheme"];
    if (fontScheme) {
      if (phType === "title" || phType === "ctrTitle") {
        const majorFont =
          fontScheme["a:majorFont"]?.["a:latin"]?.["$"]?.typeface;
        if (majorFont) defaultFontFamily = majorFont;
      } else {
        const minorFont =
          fontScheme["a:minorFont"]?.["a:latin"]?.["$"]?.typeface;
        if (minorFont) defaultFontFamily = minorFont;
      }
    }
  }
  if (defaultFontFamily === "Arial" && masterData) {
    const txStyles = masterData["p:sldMaster"]?.["p:txStyles"];
    if (txStyles) {
      const defRPr =
        txStyles["p:titleStyle"]?.["a:defRPr"] ||
        txStyles["p:otherStyle"]?.["a:defRPr"];
      const latinFont = defRPr?.["a:latin"]?.["$"]?.typeface;
      if (latinFont) defaultFontFamily = latinFont;
    }
  }

  const styles = {
    fontSize: defaultFontSize,
    fontFamily: defaultFontFamily,
    color: "#000000",
    bold: false,
    italic: false,
    align: "left",
  };

  // Apply first paragraph / first run for element-level defaults
  const paragraphs = txBody["a:p"];
  const pArray = Array.isArray(paragraphs)
    ? paragraphs
    : paragraphs
      ? [paragraphs]
      : [];

  if (pArray.length > 0) {
    const p = pArray[0];
    const pPr = p["a:pPr"];
    if (pPr) {
      const algn = pPr["$"]?.algn;
      if (algn === "ctr") styles.align = "center";
      else if (algn === "r") styles.align = "right";
      else if (algn === "just") styles.align = "justify";

      if (pPr["a:defRPr"]) applyRunProperties(styles, pPr["a:defRPr"]);
    }

    const lstStyle = txBody["a:lstStyle"];
    if (lstStyle) {
      const lvl = pPr?.["$"]?.lvl || 0;
      const lvlPr = lstStyle[`a:lvl${parseInt(lvl) + 1}pPr`];
      if (lvlPr?.["a:defRPr"]) applyRunProperties(styles, lvlPr["a:defRPr"]);
    }

    const runs = p["a:r"];
    const rArray = Array.isArray(runs) ? runs : runs ? [runs] : [];
    if (rArray.length > 0 && rArray[0]["a:rPr"]) {
      applyRunProperties(styles, rArray[0]["a:rPr"]);
    } else if (rArray.length === 0 && p["a:endParaRPr"]) {
      applyRunProperties(styles, p["a:endParaRPr"]);
    }
  }

  return styles;
}

/**
 * Apply run properties to styles object
 */
function applyRunProperties(styles, rPr) {
  const attrs = rPr["$"] || {};

  // Font size (in hundredths of a point)
  if (attrs.sz) {
    styles.fontSize = parseInt(attrs.sz) / 100;
  }

  // Bold and italic
  if (attrs.b === "1") styles.bold = true;
  if (attrs.i === "1") styles.italic = true;

  // Underline (none, sng, dbl, sngDash, dblDash, heavy, sngDot, dblDot, wavy, wavyHeavy)
  if (attrs.u) {
    styles.underline = attrs.u;
  }

  // Strikethrough (sngStrike, dblStrike, noStrike)
  if (attrs.strike) {
    styles.strikethrough =
      attrs.strike === "sngStrike" || attrs.strike === "dblStrike";
  }

  // Baseline - for subscript/superscript (30000 = superscript, -30000 = subscript)
  if (attrs.baseline) {
    styles.baseline = parseInt(attrs.baseline);
  }

  // Capitalization (small, all)
  if (attrs.cap) {
    styles.caps = attrs.cap;
  }

  // Character spacing (in hundredths of a point, negative for tighter)
  if (attrs.spc) {
    styles.spacing = parseInt(attrs.spc) / 100;
  }

  // Color (support both srgbClr and schemeClr)
  const color = extractColor(rPr);
  if (color) {
    styles.color = color;
  }

  // Font family (latin for Western, cs for complex script, ea for East Asian)
  const latin = rPr["a:latin"];
  const cs = rPr["a:cs"];
  const ea = rPr["a:ea"];
  if (latin?.["$"]?.typeface) {
    styles.fontFamily = latin["$"].typeface;
  } else if (cs?.["$"]?.typeface) {
    styles.fontFamily = cs["$"].typeface;
  } else if (ea?.["$"]?.typeface) {
    styles.fontFamily = ea["$"].typeface;
  }
}

/**
 * Extract color from run properties (supports srgbClr and schemeClr)
 */
function extractColor(rPr) {
  const solidFill = rPr["a:solidFill"];
  if (!solidFill) return null;

  // sRGB color
  const srgbClr = solidFill["a:srgbClr"]?.["$"]?.val;
  if (srgbClr) {
    return `#${srgbClr}`;
  }

  // Theme/scheme color - map common theme colors to approximate values
  const schemeClr = solidFill["a:schemeClr"]?.["$"]?.val;
  if (schemeClr) {
    return getThemeColor(schemeClr);
  }

  return null;
}

/**
 * Extract color scheme from theme data into a lookup map
 */
function extractThemeColorMap(themeData) {
  const colors = {};
  const clrScheme =
    themeData?.["a:theme"]?.["a:themeElements"]?.["a:clrScheme"];
  if (!clrScheme) return colors;

  // Map XML element names to scheme color names used in PPTX
  const colorElements = {
    "a:dk1": ["dk1", "tx1"],
    "a:lt1": ["lt1", "bg1"],
    "a:dk2": ["dk2", "tx2"],
    "a:lt2": ["lt2", "bg2"],
    "a:accent1": ["accent1"],
    "a:accent2": ["accent2"],
    "a:accent3": ["accent3"],
    "a:accent4": ["accent4"],
    "a:accent5": ["accent5"],
    "a:accent6": ["accent6"],
    "a:hlink": ["hlink"],
    "a:folHlink": ["folHlink"],
  };

  for (const [xmlKey, schemeNames] of Object.entries(colorElements)) {
    const el = clrScheme[xmlKey];
    if (!el) continue;

    let hex = null;
    const srgb = el["a:srgbClr"]?.["$"]?.val;
    if (srgb) {
      hex = `#${srgb}`;
    } else {
      const sys = el["a:sysClr"]?.["$"];
      if (sys?.lastClr) hex = `#${sys.lastClr}`;
      else if (sys?.val) hex = `#${sys.val}`;
    }

    if (hex) {
      for (const name of schemeNames) {
        colors[name] = hex;
      }
    }
  }

  return colors;
}

/**
 * Resolve a theme/scheme color name to a hex color
 */
function getThemeColor(schemeName) {
  if (resolvedThemeColors[schemeName]) {
    return resolvedThemeColors[schemeName];
  }
  // Fallback defaults
  const fallback = {
    tx1: "#000000",
    dk1: "#000000",
    bg1: "#FFFFFF",
    lt1: "#FFFFFF",
    tx2: "#444444",
    dk2: "#444444",
    bg2: "#EEEEEE",
    lt2: "#EEEEEE",
    hlink: "#0000FF",
    folHlink: "#800080",
  };
  return fallback[schemeName] || "#000000";
}

/**
 * Extract fill color from shape properties
 */
function extractFillColor(spPr) {
  if (!spPr) return null;

  // Explicit no fill
  if (spPr["a:noFill"]) return "none";

  const solidFill = spPr["a:solidFill"];
  if (solidFill) {
    return resolveColorWithAlpha(solidFill);
  }

  // Gradient fill — build CSS linear-gradient
  const gradFill = spPr["a:gradFill"];
  if (gradFill) {
    const gsLst = gradFill["a:gsLst"]?.["a:gs"];
    if (gsLst) {
      const stops = Array.isArray(gsLst) ? gsLst : [gsLst];
      const cssStops = stops.map((stop) => {
        const pos = stop["$"]?.pos ? parseInt(stop["$"].pos) / 1000 : 0;
        const color = resolveColorWithAlpha(stop);
        return `${color} ${pos}%`;
      });

      // Get angle (default 90deg = top to bottom)
      let angle = 180; // CSS default for top-to-bottom
      const lin = gradFill["a:lin"];
      if (lin?.["$"]?.ang) {
        // OOXML angle is in 60000ths of a degree, 0 = right-to-left
        angle = (parseInt(lin["$"].ang) / 60000 + 90) % 360;
      }

      return `linear-gradient(${angle}deg, ${cssStops.join(", ")})`;
    }
  }

  return null;
}

/**
 * Resolve a color node (a:srgbClr or a:schemeClr) to a CSS color string with alpha
 */
function resolveColorWithAlpha(colorNode) {
  if (!colorNode) return null;

  let hex = null;
  let alpha = 1;

  const srgb = colorNode["a:srgbClr"];
  const scheme = colorNode["a:schemeClr"];

  if (srgb) {
    hex = srgb["$"]?.val;
    const alphaVal = srgb["a:alpha"]?.["$"]?.val;
    if (alphaVal) alpha = parseInt(alphaVal) / 100000;
  } else if (scheme) {
    const resolved = getThemeColor(scheme["$"]?.val);
    hex = resolved?.replace("#", "");
    const alphaVal = scheme["a:alpha"]?.["$"]?.val;
    if (alphaVal) alpha = parseInt(alphaVal) / 100000;
  }

  if (!hex) return null;

  if (alpha < 1) {
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(2)})`;
  }

  return `#${hex}`;
}

/**
 * Extract outline from shape properties
 */
function extractOutline(spPr) {
  if (!spPr) return null;

  const ln = spPr["a:ln"];
  if (!ln || ln["a:noFill"]) return null;

  const solidFill = ln["a:solidFill"];
  if (solidFill) {
    const width = ln["$"]?.w ? (parseInt(ln["$"].w) / 914400) * 96 : 1;
    const srgbClr = solidFill["a:srgbClr"]?.["$"]?.val;
    if (srgbClr) {
      return { color: `#${srgbClr}`, width: Math.max(1, width) };
    }
    const schemeClr = solidFill["a:schemeClr"]?.["$"]?.val;
    if (schemeClr) {
      return { color: getThemeColor(schemeClr), width: Math.max(1, width) };
    }
  }

  return null;
}

/**
 * Convert parsed slides to HTML
 */
function convertToHtml(slides, presentationId) {
  const slideHtml = slides
    .map((slide, index) => {
      const elementsHtml = slide.elements
        .map((element, elIdx) => {
          // Render image elements
          if (element.type === "image") {
            const imgStyle = {
              position: "absolute",
              left: `${element.x}px`,
              top: `${element.y}px`,
              width: `${element.width}px`,
              height: `${element.height}px`,
              zIndex: elIdx,
            };
            if (element.rotation) {
              imgStyle.transform = `rotate(${element.rotation}deg)`;
            }
            const imgStyleStr = Object.entries(imgStyle)
              .map(([key, value]) => `${camelToKebab(key)}: ${value}`)
              .join("; ");

            return `
        <img class="${element.isMaster ? "master-element" : ""}"
             data-element-id="${element.id}"
             src="${element.imageData}"
             style="${imgStyleStr}" />
      `;
          }

          const hasFill = element.fillColor && element.fillColor !== "none";

          // Skip elements that have no text AND no visible fill AND no outline AND no shape
          if (
            !element.text &&
            !hasFill &&
            !element.outline &&
            !element.hasShape
          )
            return "";
          if (
            element.isMaster &&
            !element.text &&
            !hasFill &&
            !element.outline &&
            !element.hasShape
          )
            return "";

          // Container styles
          const styleObj = {
            position: "absolute",
            left: `${element.x}px`,
            top: `${element.y}px`,
            width: `${element.width}px`,
            minHeight: `${element.height}px`,
            boxSizing: "border-box",
            zIndex: elIdx,
          };

          if (!element.isMaster) {
            styleObj.borderRadius = "4px";
            styleObj.transition = "box-shadow 0.2s ease";
          }

          if (!element.text && element.hasShape) {
            styleObj.height = `${element.height}px`;
          }

          if (element.rotation) {
            styleObj.transform = `rotate(${element.rotation}deg)`;
          }

          // Body insets as padding
          if (element.bodyProps) {
            const left = element.bodyProps.leftInset
              ? element.bodyProps.leftInset * 1.333
              : 8;
            const top = element.bodyProps.topInset
              ? element.bodyProps.topInset * 1.333
              : 8;
            const right = element.bodyProps.rightInset
              ? element.bodyProps.rightInset * 1.333
              : 8;
            const bottom = element.bodyProps.bottomInset
              ? element.bodyProps.bottomInset * 1.333
              : 8;
            styleObj.padding = `${top}px ${right}px ${bottom}px ${left}px`;

            if (element.bodyProps.anchor) {
              styleObj.display = "flex";
              styleObj.flexDirection = "column";
              const anchorMap = {
                t: "flex-start",
                b: "flex-end",
                ctr: "center",
              };
              styleObj.justifyContent =
                anchorMap[element.bodyProps.anchor] || "flex-start";
            }
          } else {
            styleObj.padding = "8px";
          }

          if (hasFill) {
            if (element.fillColor.startsWith("linear-gradient")) {
              styleObj.background = element.fillColor;
            } else {
              styleObj.backgroundColor = element.fillColor;
            }
          }

          if (element.outline) {
            styleObj.border = `${element.outline.width}px solid ${element.outline.color}`;
          }

          const containerStyleStr = Object.entries(styleObj)
            .filter(([, value]) => value !== undefined)
            .map(([key, value]) => `${camelToKebab(key)}: ${value}`)
            .join("; ");

          // Render paragraphs with per-run styling
          let innerHtml = "";
          if (element.paragraphs && element.paragraphs.length > 0) {
            innerHtml = element.paragraphs
              .map((para) => {
                if (para.runs.length === 0)
                  return '<p style="margin: 0; min-height: 1em;"></p>';

                const pStyle = [];
                pStyle.push("margin: 0");
                if (para.align) pStyle.push(`text-align: ${para.align}`);
                if (para.spaceBefore)
                  pStyle.push(`margin-top: ${para.spaceBefore}pt`);
                if (para.spaceAfter)
                  pStyle.push(`margin-bottom: ${para.spaceAfter}pt`);
                if (para.rtl) pStyle.push("direction: rtl");
                const totalIndent = (para.leftMargin || 0) + (para.indent || 0);
                if (totalIndent > 0)
                  pStyle.push(`padding-left: ${totalIndent}px`);

                const bulletHtml = para.bulletChar
                  ? `<span style="margin-right: 4px">${escapeHtml(para.bulletChar)}</span>`
                  : "";

                const runsHtml = para.runs
                  .map((run) => {
                    if (!run.text) return "";
                    const s = run.style || {};
                    const spanStyle = [];
                    if (s.fontSize)
                      spanStyle.push(`font-size: ${s.fontSize}px`);
                    if (s.fontFamily)
                      spanStyle.push(`font-family: ${s.fontFamily}`);
                    if (s.color) spanStyle.push(`color: ${s.color}`);
                    if (s.bold) spanStyle.push("font-weight: bold");
                    if (s.italic) spanStyle.push("font-style: italic");
                    if (s.underline && s.underline !== "none")
                      spanStyle.push("text-decoration: underline");
                    if (s.strikethrough)
                      spanStyle.push("text-decoration: line-through");
                    if (s.caps === "all")
                      spanStyle.push("text-transform: uppercase");
                    if (s.caps === "small")
                      spanStyle.push("font-variant: small-caps");
                    if (s.spacing)
                      spanStyle.push(`letter-spacing: ${s.spacing}pt`);
                    if (s.baseline && s.baseline > 0) {
                      spanStyle.push("vertical-align: super");
                      spanStyle.push(
                        `font-size: ${(s.fontSize || 18) * 0.7}px`,
                      );
                    } else if (s.baseline && s.baseline < 0) {
                      spanStyle.push("vertical-align: sub");
                      spanStyle.push(
                        `font-size: ${(s.fontSize || 18) * 0.7}px`,
                      );
                    }

                    const escaped = escapeHtml(run.text).replace(/\n/g, "<br>");
                    return `<span style="${spanStyle.join("; ")}">${escaped}</span>`;
                  })
                  .join("");

                return `<p style="${pStyle.join("; ")}">${bulletHtml}${runsHtml}</p>`;
              })
              .join("");
          } else {
            // Fallback for elements without structured paragraphs
            innerHtml = escapeHtml(element.text || "");
          }

          const escapedText = escapeHtml(element.text || "");

          return `
        <div class="text-element${element.isMaster ? " master-element" : ""}"
             data-element-id="${element.id}"
             data-shape-idx="${element.shapeIdx != null ? element.shapeIdx : ""}"
             data-original-text="${escapedText}"${
               element.isMaster
                 ? ""
                 : `
             onclick="openEditMenu(this, event)"`
             }
             style="${containerStyleStr}">
          ${innerHtml}
        </div>
      `;
        })
        .join("");

      return `
      <div class="slide" data-slide-index="${index}" style="
        position: relative;
        width: ${slide.width}px;
        height: ${slide.height}px;
        background-color: ${slide.background};
        margin: 20px auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        overflow: hidden;">
        <style>
          .master-element {
            pointer-events: none;
            user-select: none;
          }
        </style>
        <div class="slide-number">${index + 1}</div>
        ${elementsHtml}
      </div>
    `;
    })
    .join("");

  return slideHtml;
}

/**
 * Convert camelCase to kebab-case
 */
function camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

module.exports = { parsePptx, convertToHtml };
