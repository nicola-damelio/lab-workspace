/* =========================================================================
   src/utils/docxImport.js
   Convert a Word .docx document into the app's rich-text HTML.

   What it does:
     1. Unzips the .docx (a ZIP container) with fflate.
     2. Parses word/document.xml (paragraphs, headings, runs, bold/italic,
        line breaks, tables) and the embedded figures (word/media/*).
     3. Renames each figure with the full-path convention and uploads it to
        Google Drive (Drive link used inline). Falls back to data URLs
        (temporary) if Drive is not connected.
     4. Uses the caption paragraph right after a figure ("Figure 1: ...")
        as the figure caption.
   ========================================================================= */

import { unzipSync, strFromU8 } from 'fflate';
import { uploadLocalFile, getDriveToken, withExtension } from './driveUpload';
import { suggestDriveFileName } from './driveNaming';

const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[ch]));

const stripTags = (h) => String(h)
  .replace(/<[^>]*>/g, '')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"');

/** All descendant elements (in document order) whose XML local name matches. */
const byLocal = (root, name) =>
  root && root.getElementsByTagName
    ? Array.from(root.getElementsByTagName('*')).filter((el) => el.localName === name)
    : [];

/** Plain text of a node (handles w:t, w:br, w:tab). */
const textOf = (node) => {
  if (!node || !node.childNodes) return '';
  let out = '';
  Array.from(node.childNodes).forEach((child) => {
    if (child.nodeType === 3) { out += child.nodeValue || ''; return; }
    if (child.nodeType !== 1) return;
    if (child.localName === 't') out += child.textContent || '';
    else if (child.localName === 'br') out += '\n';
    else if (child.localName === 'tab') out += '\t';
    else out += textOf(child);
  });
  return out;
};

/** The relationship id of an image inside a run, if any. */
const imageRIdOf = (run) => {
  const blip = byLocal(run, 'blip')[0];
  if (blip) {
    return blip.getAttributeNS(REL_NS, 'embed') || blip.getAttribute('r:embed') || '';
  }
  const imagedata = byLocal(run, 'imagedata')[0];
  if (imagedata) {
    return imagedata.getAttributeNS(REL_NS, 'id') || imagedata.getAttribute('r:id') || '';
  }
  return '';
};

/** Render one run (a piece of formatted text) as HTML. */
const runHtml = (run) => {
  const rPr = Array.from(run.children).find((c) => c.localName === 'pr');
  const has = (name) => !!byLocal(rPr, name).length;
  const vert = byLocal(rPr, 'vertAlign')[0];

  let t = textOf(run);
  if (!t) return '';

  const open = [];
  if (has('b')) open.push('<b>');
  if (has('i')) open.push('<i>');
  if (has('u')) open.push('<u>');
  const openStr = open.join('');
  const closeStr = open.slice().reverse().join('');

  t = t.replace(/\n/g, '<br/>');
  if (vert && vert.getAttribute('w:val') === 'superscript') t = `<sup>${t}</sup>`;
  else if (vert && vert.getAttribute('w:val') === 'subscript') t = `<sub>${t}</sub>`;

  return openStr + t + closeStr;
};

/** Map a relationship target to a path inside the zip. */
const mediaPathOf = (target) => {
  const t = String(target || '').replace(/^\.\//, '');
  if (!t) return '';
  if (t.startsWith('media/')) return `word/${t}`;
  if (t.startsWith('word/')) return t;
  if (t.startsWith('/')) return t.replace(/^\//, '');
  return `word/${t}`;
};

const extOf = (path) => {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(path || ''));
  return m ? m[1].toLowerCase() : 'png';
};

const mimeOf = (path) => ({
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  bmp: 'image/bmp', svg: 'image/svg+xml', tif: 'image/tiff', tiff: 'image/tiff',
  webp: 'image/webp', ico: 'image/x-icon'
}[extOf(path)] || 'application/octet-stream');

const bytesToDataUrl = (bytes, mime) => {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:${mime};base64,${btoa(binary)}`;
};

/** Render a paragraph as a block: text HTML or an image reference. */
const renderParagraph = (p) => {
  const pPr = Array.from(p.children).find((c) => c.localName === 'pr');
  const pStyle = (byLocal(pPr, 'pStyle')[0] || {}).getAttribute?.('w:val') || '';
  const jc = (byLocal(pPr, 'jc')[0] || {}).getAttribute?.('w:val') || '';
  const hasList = !!byLocal(pPr, 'numPr').length;

  const runs = byLocal(p, 'r');
  let html = '';
  let imgRId = '';

  runs.forEach((run) => {
    const rid = imageRIdOf(run);
    if (rid) { imgRId = rid; return; }
    html += runHtml(run);
  });

  if (imgRId) return { type: 'img', idx: null, rId: imgRId };
  if (!html.trim()) return null;

  const align = jc ? ` style="text-align:${jc};"` : '';
  if (/^Heading1$/i.test(pStyle)) return { type: 'text', html: `<h2${align}>${html}</h2>` };
  if (/^Heading2$/i.test(pStyle)) return { type: 'text', html: `<h3${align}>${html}</h3>` };
  if (/^Heading/i.test(pStyle)) return { type: 'text', html: `<h4${align}>${html}</h4>` };
  const listMark = hasList ? '• ' : '';
  return { type: 'text', html: `<p${align}>${listMark}${html}</p>` };
};

/** Upload one embedded image to Drive (or produce a temporary data URL). */
const resolveImage = async (rId, index, naming, files, rels) => {
  const target = rels[rId] || '';
  const path = mediaPathOf(target);
  const bytes = files[path] || files[path.replace(/^word\//, '')];
  if (!bytes || !bytes.length) {
    return { url: '', name: `figure${index + 1}`, drive: false, missing: true };
  }
  const mime = mimeOf(path);
  const ext = extOf(path);
  const name = withExtension(
    suggestDriveFileName({ ...naming, suffix: `figure${index + 1}` }),
    `f.${ext}`
  );
  const blob = new Blob([bytes], { type: mime });

  let drive = null;
  if (getDriveToken()) {
    try {
      drive = await uploadLocalFile({ name, mimeType: mime, file: blob });
    } catch { drive = null; }
  }
  if (drive) return { url: drive.driveUrl, name, drive: true };
  return { url: bytesToDataUrl(bytes, mime), name, drive: false };
};

/**
 * Convert a .docx ArrayBuffer into rich-text HTML.
 * @returns {{ html: string, stats: { images:number, uploadedToDrive:number, locallyStored:number } }}
 */
export const docxToHtml = async ({ arrayBuffer, naming = {} }) => {
  let files;
  try {
    files = unzipSync(new Uint8Array(arrayBuffer));
  } catch {
    throw new Error('Not a valid .docx file (it could not be unzipped).');
  }

  const xml = strFromU8(files['word/document.xml'] || new Uint8Array());
  if (!xml.trim()) throw new Error('The .docx contains no readable text.');

  const doc = new DOMParser().parseFromString(xml, 'application/xml');

  const rels = {};
  try {
    const relsXml = strFromU8(files['word/_rels/document.xml.rels'] || '');
    if (relsXml.trim()) {
      const rd = new DOMParser().parseFromString(relsXml, 'application/xml');
      Array.from(rd.getElementsByTagName('Relationship')).forEach((r) => {
        rels[r.getAttribute('Id')] = r.getAttribute('Target') || '';
      });
    }
  } catch { /* no relationships — images will be skipped */ }

  const body = byLocal(doc, 'body')[0];
  const children = Array.from(body ? body.children : []).filter(
    (c) => c.localName === 'p' || c.localName === 'tbl'
  );

  // Build blocks and collect image relationship ids in document order.
  const imgRids = [];
  const blocks = [];
  children.forEach((c) => {
    if (c.localName === 'tbl') { blocks.push(renderTable(c)); return; }
    const b = renderParagraph(c);
    if (!b) return;
    if (b.type === 'img') {
      b.idx = imgRids.length;
      imgRids.push(b.rId);
      blocks.push(b);
    } else {
      blocks.push(b);
    }
  });

  // Merge an image with the caption paragraph that follows it ("Figure 1: …").
  const merged = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'img') {
      let caption = '';
      const next = blocks[i + 1];
      if (next && next.type === 'text' && /^(fig(ure)?\.?\s*\d*\s*[:.-]?)/i.test(stripTags(next.html))) {
        caption = stripTags(next.html).trim();
        i++;
      }
      merged.push({ type: 'fig', idx: b.idx, caption });
    } else {
      merged.push(b);
    }
  }

  // Upload the images (sequentially) so Drive rate limits are respected.
  const results = [];
  for (let i = 0; i < imgRids.length; i++) {
    results.push(await resolveImage(imgRids[i], i, naming, files, rels));
  }

  let html = '';
  merged.forEach((b) => {
    if (b.type === 'fig') {
      const r = results[b.idx] || {};
      const imgSrc = r.url ? escapeHtml(r.url) : '';
      html += `<figure style="margin:14px 0;text-align:center;break-inside:avoid;">`;
      if (imgSrc) {
        html += `<img src="${imgSrc}" alt="${escapeHtml(r.name || 'figure')}" style="max-width:100%;height:auto;border:1px solid #e2e8f0;border-radius:8px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,0.08);"/>`;
      }
      if (b.caption) {
        html += `<figcaption style="font-size:12px;color:#475569;margin-top:4px;">${escapeHtml(b.caption)}</figcaption>`;
      }
      html += '</figure>';
    } else {
      html += b.html;
    }
  });

  return {
    html,
    stats: {
      images: results.length,
      uploadedToDrive: results.filter((r) => r.drive).length,
      locallyStored: results.filter((r) => !r.drive && !r.missing).length
    }
  };
};


/** Render a Word table as a simple HTML table. */
const renderTable = (tbl) => {
  let html = '<table style="width:100%; border-collapse: collapse;" border="1"><tbody>';
  byLocal(tbl, 'tr').forEach((tr) => {
    html += '<tr>';
    byLocal(tr, 'tc').forEach((tc) => {
      const cells = byLocal(tc, 'p').map((p) => textOf(p).trim()).filter(Boolean);
      html += `<td style="padding:4px; border:1px solid #cbd5e1;">${cells.map(escapeHtml).join('<br/>')}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  return { type: 'text', html };
};
