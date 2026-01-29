const JSZip = require('jszip');
const xml2js = require('xml2js');

/**
 * Parse a PPTX file buffer and extract slide content
 */
async function parsePptx(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const slides = [];

  // Get presentation.xml to understand slide order
  const presentationXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presentationXml) {
    throw new Error('Invalid PPTX file: missing presentation.xml');
  }

  const parser = new xml2js.Parser({ explicitArray: false, ignoreAttrs: false });
  const presentation = await parser.parseStringPromise(presentationXml);

  // Get slide relationship IDs
  const slideRels = presentation['p:presentation']?.['p:sldIdLst']?.['p:sldId'];
  const slideIds = Array.isArray(slideRels) ? slideRels : slideRels ? [slideRels] : [];

  // Parse relationships to get slide file names
  const relsXml = await zip.file('ppt/_rels/presentation.xml.rels')?.async('string');
  const rels = await parser.parseStringPromise(relsXml);
  const relationships = rels['Relationships']?.['Relationship'];
  const relArray = Array.isArray(relationships) ? relationships : relationships ? [relationships] : [];

  // Create a map of relationship IDs to slide files
  const relMap = new Map();
  relArray.forEach(rel => {
    if (rel['$']?.Target?.includes('slide')) {
      relMap.set(rel['$'].Id, rel['$'].Target);
    }
  });

  // Get slide dimensions from presentation
  const sldSz = presentation['p:presentation']?.['p:sldSz'];
  const slideWidth = sldSz?.['$']?.cx ? parseInt(sldSz['$'].cx) / 914400 * 96 : 960; // EMUs to pixels
  const slideHeight = sldSz?.['$']?.cy ? parseInt(sldSz['$'].cy) / 914400 * 96 : 540;

  // Parse each slide
  let slideIndex = 0;
  for (const slideId of slideIds) {
    const relId = slideId['$']?.['r:id'];
    let slideFile = relMap.get(relId);

    if (!slideFile) {
      // Fallback: try to find slide by index
      slideFile = `slides/slide${slideIndex + 1}.xml`;
    }

    const slidePath = `ppt/${slideFile}`;
    const slideXml = await zip.file(slidePath)?.async('string');

    if (slideXml) {
      const slideData = await parser.parseStringPromise(slideXml);
      const elements = extractSlideElements(slideData, slideWidth, slideHeight, slideIndex);

      // Try to get slide background
      const background = extractBackground(slideData);

      slides.push({
        index: slideIndex,
        width: slideWidth,
        height: slideHeight,
        elements,
        background
      });
    }
    slideIndex++;
  }

  // If no slides found through relationships, try direct file access
  if (slides.length === 0) {
    const slideFiles = Object.keys(zip.files).filter(f => f.match(/ppt\/slides\/slide\d+\.xml$/));
    slideFiles.sort((a, b) => {
      const numA = parseInt(a.match(/slide(\d+)/)[1]);
      const numB = parseInt(b.match(/slide(\d+)/)[1]);
      return numA - numB;
    });

    for (let i = 0; i < slideFiles.length; i++) {
      const slideXml = await zip.file(slideFiles[i])?.async('string');
      if (slideXml) {
        const slideData = await parser.parseStringPromise(slideXml);
        const elements = extractSlideElements(slideData, slideWidth, slideHeight, i);
        const background = extractBackground(slideData);

        slides.push({
          index: i,
          width: slideWidth,
          height: slideHeight,
          elements,
          background
        });
      }
    }
  }

  return slides;
}

/**
 * Extract background color from slide
 */
function extractBackground(slideData) {
  const cSld = slideData['p:sld']?.['p:cSld'];
  const bg = cSld?.['p:bg'];

  if (bg) {
    const bgPr = bg['p:bgPr'];
    if (bgPr) {
      const solidFill = bgPr['a:solidFill'];
      if (solidFill) {
        const srgbClr = solidFill['a:srgbClr']?.['$']?.val;
        if (srgbClr) {
          return `#${srgbClr}`;
        }
      }
    }
  }

  return '#ffffff'; // Default white background
}

/**
 * Extract elements (text boxes, shapes) from a slide
 */
function extractSlideElements(slideData, slideWidth, slideHeight, slideIndex) {
  const elements = [];
  const cSld = slideData['p:sld']?.['p:cSld'];
  const spTree = cSld?.['p:spTree'];

  if (!spTree) return elements;

  // Process shapes (sp elements)
  const shapes = spTree['p:sp'];
  const shapeArray = Array.isArray(shapes) ? shapes : shapes ? [shapes] : [];

  shapeArray.forEach((shape, idx) => {
    const element = extractShapeElement(shape, slideWidth, slideHeight, slideIndex, idx);
    if (element) {
      elements.push(element);
    }
  });

  return elements;
}

/**
 * Extract a single shape element
 */
function extractShapeElement(shape, slideWidth, slideHeight, slideIndex, shapeIndex) {
  const spPr = shape['p:spPr'];
  const txBody = shape['p:txBody'];

  // Get position and size
  const xfrm = spPr?.['a:xfrm'];
  const off = xfrm?.['a:off']?.['$'];
  const ext = xfrm?.['a:ext']?.['$'];

  // Convert EMUs to pixels (914400 EMUs = 1 inch, assume 96 DPI)
  const emuToPixel = (emu) => emu ? parseInt(emu) / 914400 * 96 : 0;

  const x = emuToPixel(off?.x);
  const y = emuToPixel(off?.y);
  const width = emuToPixel(ext?.cx);
  const height = emuToPixel(ext?.cy);

  // Extract text content
  const textContent = extractTextContent(txBody);

  // Get shape fill color
  const fillColor = extractFillColor(spPr);

  // Get shape outline
  const outline = extractOutline(spPr);

  if (!textContent && !fillColor && !outline) {
    return null;
  }

  return {
    id: `slide${slideIndex}-shape${shapeIndex}`,
    type: 'textbox',
    x: x,
    y: y,
    width: width || 200,
    height: height || 50,
    text: textContent,
    fillColor,
    outline,
    styles: extractTextStyles(txBody)
  };
}

/**
 * Extract text content from txBody
 */
function extractTextContent(txBody) {
  if (!txBody) return '';

  const paragraphs = txBody['a:p'];
  const pArray = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];

  const textParts = [];
  pArray.forEach(p => {
    const runs = p['a:r'];
    const rArray = Array.isArray(runs) ? runs : runs ? [runs] : [];

    const paragraphText = rArray.map(r => {
      const t = r['a:t'];
      if (typeof t === 'string') return t;
      if (typeof t === 'object' && t._) return t._;
      return '';
    }).join('');

    // Also check for field text (like page numbers)
    const fld = p['a:fld'];
    if (fld) {
      const fldArray = Array.isArray(fld) ? fld : [fld];
      fldArray.forEach(f => {
        const t = f['a:t'];
        if (typeof t === 'string') textParts.push(t);
      });
    }

    if (paragraphText) {
      textParts.push(paragraphText);
    }
  });

  return textParts.join('\n');
}

/**
 * Extract text styles from txBody
 */
function extractTextStyles(txBody) {
  if (!txBody) return {};

  const styles = {
    fontSize: 18,
    fontFamily: 'Arial',
    color: '#000000',
    bold: false,
    italic: false,
    align: 'left'
  };

  const paragraphs = txBody['a:p'];
  const pArray = Array.isArray(paragraphs) ? paragraphs : paragraphs ? [paragraphs] : [];

  if (pArray.length > 0) {
    const p = pArray[0];

    // Paragraph properties
    const pPr = p['a:pPr'];
    if (pPr) {
      const algn = pPr['$']?.algn;
      if (algn === 'ctr') styles.align = 'center';
      else if (algn === 'r') styles.align = 'right';
      else if (algn === 'just') styles.align = 'justify';
    }

    // Run properties
    const runs = p['a:r'];
    const rArray = Array.isArray(runs) ? runs : runs ? [runs] : [];
    if (rArray.length > 0) {
      const rPr = rArray[0]['a:rPr'];
      if (rPr) {
        // Font size (in hundredths of a point)
        if (rPr['$']?.sz) {
          styles.fontSize = parseInt(rPr['$'].sz) / 100;
        }

        // Bold and italic
        if (rPr['$']?.b === '1') styles.bold = true;
        if (rPr['$']?.i === '1') styles.italic = true;

        // Color
        const solidFill = rPr['a:solidFill'];
        if (solidFill) {
          const srgbClr = solidFill['a:srgbClr']?.['$']?.val;
          if (srgbClr) {
            styles.color = `#${srgbClr}`;
          }
        }

        // Font family
        const latin = rPr['a:latin'];
        if (latin?.['$']?.typeface) {
          styles.fontFamily = latin['$'].typeface;
        }
      }
    }
  }

  return styles;
}

/**
 * Extract fill color from shape properties
 */
function extractFillColor(spPr) {
  if (!spPr) return null;

  const solidFill = spPr['a:solidFill'];
  if (solidFill) {
    const srgbClr = solidFill['a:srgbClr']?.['$']?.val;
    if (srgbClr) {
      return `#${srgbClr}`;
    }
  }

  return null;
}

/**
 * Extract outline from shape properties
 */
function extractOutline(spPr) {
  if (!spPr) return null;

  const ln = spPr['a:ln'];
  if (ln) {
    const solidFill = ln['a:solidFill'];
    if (solidFill) {
      const srgbClr = solidFill['a:srgbClr']?.['$']?.val;
      if (srgbClr) {
        const width = ln['$']?.w ? parseInt(ln['$'].w) / 914400 * 96 : 1;
        return {
          color: `#${srgbClr}`,
          width: Math.max(1, width)
        };
      }
    }
  }

  return null;
}

/**
 * Convert parsed slides to HTML
 */
function convertToHtml(slides, presentationId) {
  const slideHtml = slides.map((slide, index) => {
    const elementsHtml = slide.elements.map(element => {
      if (!element.text && !element.fillColor) return '';

      const styleObj = {
        position: 'absolute',
        left: `${element.x}px`,
        top: `${element.y}px`,
        width: `${element.width}px`,
        minHeight: `${element.height}px`,
        fontSize: `${element.styles?.fontSize || 18}px`,
        fontFamily: element.styles?.fontFamily || 'Arial',
        color: element.styles?.color || '#000000',
        fontWeight: element.styles?.bold ? 'bold' : 'normal',
        fontStyle: element.styles?.italic ? 'italic' : 'normal',
        textAlign: element.styles?.align || 'left',
        padding: '8px',
        boxSizing: 'border-box',
        cursor: 'pointer',
        borderRadius: '4px',
        transition: 'box-shadow 0.2s ease'
      };

      if (element.fillColor) {
        styleObj.backgroundColor = element.fillColor;
      }

      if (element.outline) {
        styleObj.border = `${element.outline.width}px solid ${element.outline.color}`;
      }

      const styleStr = Object.entries(styleObj)
        .map(([key, value]) => `${camelToKebab(key)}: ${value}`)
        .join('; ');

      const escapedText = escapeHtml(element.text || '');
      const displayText = escapedText.replace(/\n/g, '<br>');

      return `
        <div class="text-element"
             data-element-id="${element.id}"
             data-original-text="${escapedText}"
             style="${styleStr}"
             onclick="openEditMenu(this, event)">
          ${displayText}
        </div>
      `;
    }).join('');

    return `
      <div class="slide" data-slide-index="${index}" style="
        position: relative;
        width: ${slide.width}px;
        height: ${slide.height}px;
        background-color: ${slide.background};
        margin: 20px auto;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
        overflow: hidden;
      ">
        <div class="slide-number">${index + 1}</div>
        ${elementsHtml}
      </div>
    `;
  }).join('');

  return slideHtml;
}

/**
 * Convert camelCase to kebab-case
 */
function camelToKebab(str) {
  return str.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = { parsePptx, convertToHtml };
