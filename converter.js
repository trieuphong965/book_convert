// converter.js - TXT / Aozora Bunko / EPUB -> .book (port 1:1 cua pc/book_converter.py).
// Chay trong trinh duyet (window.BookConverter) va node (require). Can entities.js.
// Moi xu ly o phia client: khong gui file di dau.
(function (g) {
  'use strict';

  const ENT = (typeof module === 'object' && module.exports) ? require('./entities.js') : g.ReaderEntities;
  const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const INVALID_CPS = new Set(ENT.invalidCodepoints);

  // Khoang trang theo Python str.isspace() / re \s (khac JS \s: co \x1c-\x1f, \x85; khong co ﻿)
  const WS = '\\t\\n\\x0b\\x0c\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
  const RE_STRIP = new RegExp(`^[${WS}]+|[${WS}]+$`, 'g');
  const pyStrip = (s) => s.replace(RE_STRIP, '');
  const cpLen = (s) => { let n = 0; for (const _ of s) n++; return n; };   // len() theo code point

  // --- regex dung chung (giong book_converter.py) ---
  const RE_AOZORA_RUBY = /[｜|]?([^｜|《]*?)《[^》]*》/g;
  const RE_AOZORA_RUBY_BARE = /《[^》]*》/g;
  const RE_AOZORA_NOTE = /[［[]＃[^］\]]*[］\]]/g;
  const RE_HR = new RegExp(`^[-─―━]{3,}[${WS}]*$`);
  const RE_CHAPTER = new RegExp(`^[${WS}]*(第[0-9０-９一二三四五六七八九十百千]+[章話節巻部編]|序章|終章|プロローグ|エピローグ)`);

  // ---------------- Giai ma TXT ----------------
  // EUC-JP: 6 ma WHATWG giai khac Python euc_jp -> dua ve ky tu Python (co trong atlas)
  const EUC_FIX = { '～': '〜', '∥': '‖', '－': '−', '￠': '¢', '￡': '£', '￢': '¬' };
  const RE_EUC_FIX = /[～∥－￠￡￢]/g;

  function tryDecode(bytes, enc) {
    try { return new TextDecoder(enc, { fatal: true }).decode(bytes); } catch (e) { return null; }
  }

  // Thu tu giong Python: utf-8-sig -> cp932 -> euc_jp -> cp932 (errors=replace)
  // WHATWG "shift_jis" = cp932 (da doi chieu toan bo bang ma 2 byte).
  function detectDecode(bytes) {
    let s = tryDecode(bytes, 'utf-8');   // TextDecoder tu bo 1 BOM dau = utf-8-sig
    if (s !== null) {
      const bom = bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
      return { text: s, encoding: bom ? 'UTF-8 (BOM)' : 'UTF-8' };
    }
    s = tryDecode(bytes, 'shift_jis');
    if (s !== null) return { text: s, encoding: 'Shift_JIS (CP932)' };
    s = tryDecode(bytes, 'euc-jp');
    if (s !== null) return { text: s.replace(RE_EUC_FIX, (c) => EUC_FIX[c]), encoding: 'EUC-JP' };
    return { text: new TextDecoder('shift_jis').decode(bytes), encoding: 'Shift_JIS (lỗi một phần)', lossy: true };
  }

  function normalizeText(s) {
    s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return s.split(' ').join(' ').split('　\n').join('\n');
  }

  function stripAozora(text) {
    const out = [];
    for (let ln of text.split('\n')) {
      if (RE_HR.test(ln)) continue;          // khoi chu thich dau file nam giua 2 duong gach ngang
      ln = ln.replace(RE_AOZORA_NOTE, '');
      ln = ln.replace(RE_AOZORA_RUBY, '$1');
      ln = ln.replace(RE_AOZORA_RUBY_BARE, '');
      out.push(ln);
    }
    return out.join('\n');
  }

  // Tra ve [{name, text}]. Khong thay heading -> 1 chuong "本文".
  function splitChapters(text) {
    const chapters = [];
    let curName = null, curLines = [];
    for (const ln of text.split('\n')) {
      const t = pyStrip(ln);
      if (RE_CHAPTER.test(t) && cpLen(t) <= 30) {
        if (curLines.length || curName) chapters.push({ name: curName || '本文', text: pyStrip(curLines.join('\n')) });
        curName = t;
        curLines = [];
      } else curLines.push(ln);
    }
    if (curLines.length || curName) chapters.push({ name: curName || '本文', text: pyStrip(curLines.join('\n')) });
    if (!chapters.length) chapters.push({ name: '本文', text: pyStrip(text) });
    return chapters;
  }

  function loadTxt(bytes) {
    const d = detectDecode(bytes);
    let text = normalizeText(d.text);
    const aozora = text.includes('《') || text.includes('［＃') || text.includes('［#');
    if (aozora) text = stripAozora(text);
    return { text, encoding: d.encoding, lossy: !!d.lossy, aozora };
  }

  // ---------------- HTML (giong Python html.unescape) ----------------
  const RE_CHARREF = /&(#[0-9]+;?|#[xX][0-9a-fA-F]+;?|[^\t\n\f <&#;]{1,32};?)/gu;

  function replaceCharref(_, s) {
    if (s[0] === '#') {
      const hex = s[1] === 'x' || s[1] === 'X';
      const num = parseInt(s.slice(hex ? 2 : 1).replace(/;$/, ''), hex ? 16 : 10);
      if (num <= 0x10FFFF && hasOwn(ENT.invalidCharrefs, String(num))) return ENT.invalidCharrefs[num];
      if ((num >= 0xD800 && num <= 0xDFFF) || num > 0x10FFFF) return '�';
      if (INVALID_CPS.has(num)) return '';
      return String.fromCodePoint(num);
    }
    if (hasOwn(ENT.named, s)) return ENT.named[s];
    const cps = Array.from(s);                       // ten dai nhat khop (theo chuan HTML5)
    for (let x = cps.length - 1; x > 1; x--) {
      const head = cps.slice(0, x).join('');
      if (hasOwn(ENT.named, head)) return ENT.named[head] + cps.slice(x).join('');
    }
    return '&' + s;
  }
  const unescape = (s) => (s.includes('&') ? s.replace(RE_CHARREF, replaceCharref) : s);

  const RE_TAG = /<[^>]+>/g;
  const RE_RT = /<rt\b[^>]*>[\s\S]*?<\/rt>/giu;
  const RE_RP = /<rp\b[^>]*>[\s\S]*?<\/rp>/giu;
  const RE_SCRIPT = /<(script|style)\b[\s\S]*?<\/\1>/giu;
  const RE_BLOCK_END = new RegExp(`</(p|div|h[1-6]|br|li)[${WS}]*>|<br[${WS}]*/?>`, 'giu');
  const RE_HEAD = /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/iu;
  const RE_TITLE = /<title[^>]*>([\s\S]*?)<\/title>/iu;

  function htmlToText(html) {
    html = html.replace(RE_RT, '').replace(RE_RP, '').replace(RE_SCRIPT, '');
    html = html.replace(RE_BLOCK_END, '\n').replace(RE_TAG, '');
    html = unescape(html);
    const out = [];
    let blank = false;
    for (const raw of html.split('\n')) {    // gom dong trong
      const ln = pyStrip(raw);
      if (ln) { out.push(ln); blank = false; }
      else if (!blank) { out.push(''); blank = true; }
    }
    return pyStrip(out.join('\n'));
  }

  // ---------------- ZIP toi gian (EPUB) ----------------
  const CP437_HI = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
  function decodeCp437(b) {
    let s = '';
    for (const c of b) s += c < 0x80 ? String.fromCharCode(c) : CP437_HI[c - 0x80];
    return s;
  }

  async function inflateRaw(data) {
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function openZip(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let eocd = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xFFFF); i--)
      if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Không phải file ZIP/EPUB hợp lệ');
    const count = dv.getUint16(eocd + 10, true);
    const cdSize = dv.getUint32(eocd + 12, true);
    let cdOff = dv.getUint32(eocd + 16, true);
    if (count === 0xFFFF || cdOff === 0xFFFFFFFF) throw new Error('EPUB dạng ZIP64 chưa được hỗ trợ');
    const concat = eocd - cdSize - cdOff;     // du lieu chen truoc zip (giong zipfile)
    cdOff += concat;

    const names = [], byName = new Map();
    let p = cdOff;
    for (let k = 0; k < count; k++) {
      if (p + 46 > buf.length || dv.getUint32(p, true) !== 0x02014B50) throw new Error('ZIP hỏng (central directory)');
      const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true) + concat;
      const nb = buf.subarray(p + 46, p + 46 + nlen);
      const name = (flags & 0x800) ? new TextDecoder('utf-8').decode(nb) : decodeCp437(nb);
      names.push(name);
      byName.set(name, { flags, method, csize, local });   // trung ten: entry sau thang (giong zipfile)
      p += 46 + nlen + xlen + clen;
    }

    async function read(name) {
      const e = byName.get(name);
      if (!e) throw new Error('Không thấy trong ZIP: ' + name);
      if (e.flags & 1) throw new Error('EPUB bị mã hoá (DRM) — không đọc được');
      if (dv.getUint32(e.local, true) !== 0x04034B50) throw new Error('ZIP hỏng (local header)');
      const start = e.local + 30 + dv.getUint16(e.local + 26, true) + dv.getUint16(e.local + 28, true);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return data;
      if (e.method === 8) return inflateRaw(data);
      throw new Error('ZIP dùng kiểu nén chưa hỗ trợ (' + e.method + ')');
    }
    return { names, read };
  }

  const utf8Replace = (b) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);   // = decode("utf-8", errors="replace")

  async function loadEpub(bytes) {
    const z = openZip(bytes);
    const opfName = z.names.find((n) => n.toLowerCase().endsWith('.opf'));
    if (!opfName) throw new Error('EPUB không có file .opf');
    const opf = utf8Replace(await z.read(opfName));
    const base = opfName.includes('/') ? opfName.slice(0, opfName.lastIndexOf('/')) : '';

    // manifest id -> href (hai thu tu thuoc tinh)
    const manifest = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*\bid="([^"]+)"[^>]*\bhref="([^"]+)"/g)) manifest.set(m[1], m[2]);
    const manifest2 = new Map();
    for (const m of opf.matchAll(/<item\b[^>]*\bhref="([^"]+)"[^>]*\bid="([^"]+)"/g)) manifest2.set(m[1], m[2]);
    for (const [href, iid] of manifest2) if (!manifest.has(iid)) manifest.set(iid, href);
    const spine = Array.from(opf.matchAll(/<itemref\b[^>]*\bidref="([^"]+)"/g), (m) => m[1]);

    const chapters = [];
    for (const iid of spine) {
      const href = manifest.get(iid);
      if (!href) continue;
      let full = (base ? base + '/' + href : href).split('//').join('/');
      if (!z.names.includes(full)) {
        const cand = z.names.find((n) => n.endsWith(href));
        if (cand === undefined) continue;
        full = cand;
      }
      const html = utf8Replace(await z.read(full));
      const text = htmlToText(html);
      if (!pyStrip(text)) continue;
      // Ten chuong: <h1-3> hoac <title> (bo furigana <rt>/<rp>)
      const mt = RE_HEAD.exec(html) || RE_TITLE.exec(html);
      const fallback = `第${chapters.length + 1}章`;
      let name = mt ? pyStrip(unescape(mt[1].replace(RE_RT, '').replace(RE_RP, '').replace(RE_TAG, ''))) : fallback;
      name = Array.from(name).slice(0, 40).join('') || fallback;
      chapters.push({ name, text: normalizeText(text) });
    }
    if (!chapters.length) throw new Error('EPUB không bóc được nội dung');
    return chapters;
  }

  // ---------------- .book ----------------
  function buildBook(title, chapters, vertical = true) {
    if (chapters.length > 0xFFFF) throw new Error('Quá nhiều chương (tối đa 65535)');
    const enc = new TextEncoder();
    const bodies = chapters.map((c) => enc.encode(c.text));
    const names = chapters.map((c) => enc.encode(c.name));
    const titleB = enc.encode(title);
    for (const n of names) if (n.length > 0xFFFF) throw new Error('Tên chương quá dài');

    const chapTableOff = 32;
    const stringsOff = chapTableOff + chapters.length * 12;
    const textOff = stringsOff + titleB.length + names.reduce((a, n) => a + n.length, 0);
    const textLen = bodies.reduce((a, b) => a + b.length + 2, 0);   // moi chuong + "\n\n"
    const out = new Uint8Array(textOff + textLen);
    const dv = new DataView(out.buffer);

    out.set([0x42, 0x4F, 0x4F, 0x4B], 0);        // "BOOK"
    dv.setUint8(4, 1);                           // version
    dv.setUint8(5, vertical ? 1 : 0);            // flags bit0: uu tien doc doc
    dv.setUint16(6, chapters.length, true);
    dv.setUint32(8, stringsOff, true);           // title_offset
    dv.setUint32(12, titleB.length, true);
    dv.setUint32(16, chapTableOff, true);
    dv.setUint32(20, textOff, true);
    dv.setUint32(24, textLen, true);
    dv.setUint32(28, 0, true);

    let sp = stringsOff;
    out.set(titleB, sp); sp += titleB.length;
    let tp = 0;
    chapters.forEach((_, i) => {
      const e = chapTableOff + i * 12;
      dv.setUint32(e, sp, true);
      dv.setUint16(e + 4, names[i].length, true);
      dv.setUint32(e + 6, tp, true);
      dv.setUint16(e + 10, 0, true);
      out.set(names[i], sp); sp += names[i].length;
      out.set(bodies[i], textOff + tp);
      out[textOff + tp + bodies[i].length] = 0x0A;
      out[textOff + tp + bodies[i].length + 1] = 0x0A;
      tp += bodies[i].length + 2;
    });
    return out;
  }

  // ---------------- API ----------------
  // Ten file khong duoi (giong Path.stem)
  function fileStem(fileName) {
    const base = fileName.replace(/^.*[\\/]/, '');
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
  }

  // Doc file nguon -> { kind: 'epub'|'aozora'|'txt', encoding, chapters, defaultTitle }
  async function parse(fileName, bytes) {
    const defaultTitle = fileStem(fileName);
    if (/\.epub$/i.test(fileName)) {
      return { kind: 'epub', encoding: 'UTF-8', lossy: false, chapters: await loadEpub(bytes), defaultTitle };
    }
    const t = loadTxt(bytes);
    return { kind: t.aozora ? 'aozora' : 'txt', encoding: t.encoding, lossy: t.lossy, chapters: splitChapters(t.text), defaultTitle };
  }

  const api = { parse, buildBook, fileStem, cpLen, detectDecode, normalizeText, stripAozora, splitChapters, htmlToText, unescape, openZip };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else g.BookConverter = api;
})(typeof self !== 'undefined' ? self : this);
