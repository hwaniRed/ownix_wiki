// 페이지를 .docx / .xlsx / .pptx 로 변환한다.
// 라이브러리는 vendor/ 폴더에 포함된 docx.js, SheetJS, PptxGenJS 를 쓰고, 호출하는 쪽에서 넘겨받는다.
// 브라우저(window.WikiExport)와 Node(require, 테스트용) 양쪽에서 동작한다.
(function(root, factory){
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WikiExport = factory();
})(typeof self !== 'undefined' ? self : this, function(){
'use strict';
var FONT = '맑은 고딕';
var ACCENT = '2F6FDE', TEXT = '1F2328', MUTED = '6B6F76', CODE_BG = 'F2F1EE', LINE = 'BFBFBF';

/* ---------- 마크다운 → 블록 구조 ---------- */
var LIST = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
var SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
var HR = /^\s*(---|\*\*\*|___)\s*$/;

function cells(r){ return r.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(function(c){ return c.trim(); }); }
function isTable(L, i){ return L[i].indexOf('|') >= 0 && i + 1 < L.length && SEP.test(L[i + 1]); }

function parse(src){
  var L = String(src || '').replace(/\r/g, '').split('\n'), out = [], i = 0, m;
  while (i < L.length) {
    var l = L[i];
    if (!l.trim()) { i++; continue; }
    if (/^```/.test(l)) {
      var buf = []; i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      i++; out.push({ t: 'code', lines: buf }); continue;
    }
    if ((m = l.match(/^(#{1,6})\s+(.*)$/))) { out.push({ t: 'h', level: m[1].length, text: m[2] }); i++; continue; }
    if (HR.test(l)) { out.push({ t: 'hr' }); i++; continue; }
    if (/^>/.test(l)) {
      var q = [];
      while (i < L.length && /^>/.test(L[i])) q.push(L[i++].replace(/^>\s?/, ''));
      out.push({ t: 'quote', blocks: parse(q.join('\n')) }); continue;
    }
    if (isTable(L, i)) {
      var head = cells(l), rows = []; i += 2;
      while (i < L.length && L[i].indexOf('|') >= 0 && L[i].trim()) {
        var r = cells(L[i++]);
        rows.push(head.map(function(_, k){ return r[k] || ''; }));
      }
      out.push({ t: 'table', head: head, rows: rows }); continue;
    }
    if (LIST.test(l)) {
      var items = [], stack = [];
      while (i < L.length && LIST.test(L[i])) {
        var mm = L[i].match(LIST), ind = mm[1].replace(/\t/g, '  ').length;
        while (stack.length && ind < stack[stack.length - 1]) stack.pop();
        if (!stack.length || ind > stack[stack.length - 1]) stack.push(ind);
        var cb = mm[3].match(/^\[([ xX])\]\s+(.*)$/);
        items.push({ level: Math.min(stack.length - 1, 4), ordered: /\d/.test(mm[2]), task: cb ? cb[1] !== ' ' : null, text: cb ? cb[2] : mm[3] });
        i++;
      }
      out.push({ t: 'list', items: items }); continue;
    }
    var p = [];
    while (i < L.length && L[i].trim() && !/^(#{1,6}\s|```|>)/.test(L[i]) && !LIST.test(L[i]) && !HR.test(L[i]) && !isTable(L, i)) p.push(L[i++]);
    if (!p.length) p.push(L[i++]);
    out.push({ t: 'p', lines: p });
  }
  return out;
}

// 인라인 서식 → [{text, b, i, s, code, wiki, url}]
function runs(s){
  var out = [], re = /(`[^`]+`)|(\[\[[^\]]+?\]\])|(\[[^\]]+\]\([^)\s]+\))|(\*\*[^*]+?\*\*)|(~~[^~]+?~~)|(\*[^*\s][^*]*?\*)/g, last = 0, m;
  s = String(s || '');
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    var t = m[0];
    if (m[1]) out.push({ text: t.slice(1, -1), code: true });
    else if (m[2]) out.push({ text: t.slice(2, -2).trim(), wiki: true });
    else if (m[3]) {
      var lk = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      out.push({ text: lk[1], url: /^(https?:|mailto:)/i.test(lk[2]) ? lk[2] : null });
    }
    else if (m[4]) runs(t.slice(2, -2)).forEach(function(r){ r.b = true; out.push(r); });
    else if (m[5]) runs(t.slice(2, -2)).forEach(function(r){ r.s = true; out.push(r); });
    else runs(t.slice(1, -1)).forEach(function(r){ r.i = true; out.push(r); });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}
function plain(s){ return runs(s).map(function(r){ return r.text; }).join(''); }
// 한글 등 전각 문자는 2칸으로 계산 (열 너비, 줄 수 추정용)
function width(s){ var w = 0; for (var i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2E80 ? 2 : 1; return w; }
// 인용 안의 블록까지 펼친다
function flat(blocks){
  var out = [];
  blocks.forEach(function(b){ if (b.t === 'quote') flat(b.blocks).forEach(function(x){ x.quote = true; out.push(x); }); else out.push(b); });
  return out;
}
function metaLine(ctx){ return [ctx.path, ctx.updated ? '마지막 수정 ' + ctx.updated : '', ctx.by].filter(Boolean).join(' · '); }
function b64ToBytes(b64){ var s = atob(b64), out = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }

/* ---------- Word (.docx) : docx.js ---------- */
function buildDocx(page, ctx, D){
  var FONTS = { ascii: FONT, eastAsia: FONT, hAnsi: FONT, cs: FONT };
  var CODE = { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: FONT, cs: 'Consolas' };
  var BORDER = { style: D.BorderStyle.SINGLE, size: 4, color: LINE };
  var SHADE = { type: D.ShadingType.CLEAR, color: 'auto', fill: CODE_BG };
  var HEADINGS = [D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3];
  var olInstance = 0;

  function textRuns(s, base){
    base = base || {};
    return runs(s).map(function(r){
      var o = { text: r.text, bold: !!(r.b || base.bold), italics: !!(r.i || base.italics), strike: !!(r.s || base.strike) };
      var color = base.color || ((r.url || r.wiki) ? ACCENT : null);
      if (color) o.color = color;
      if (r.code) { o.font = CODE; o.shading = SHADE; }
      if (r.url || r.wiki) o.underline = { type: r.wiki ? D.UnderlineType.DASH : D.UnderlineType.SINGLE, color: ACCENT };
      var run = new D.TextRun(o);
      return r.url ? new D.ExternalHyperlink({ link: r.url, children: [run] }) : run;
    });
  }
  function lineRuns(lines, base){
    var out = [];
    lines.forEach(function(l, k){ if (k) out.push(new D.TextRun({ text: '', break: 1 })); out = out.concat(textRuns(l, base)); });
    return out;
  }
  function render(b){
    var style = b.quote ? 'WikiQuote' : undefined;
    switch (b.t) {
      case 'h': return [new D.Paragraph({ heading: HEADINGS[Math.min(b.level, 3) - 1], children: textRuns(b.text, { bold: true }) })];
      case 'p': return [new D.Paragraph({ style: style, children: lineRuns(b.lines) })];
      case 'hr': return [new D.Paragraph({ children: [], border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'D0D0D0', space: 1 } } })];
      case 'code': return [new D.Paragraph({ style: 'WikiCode', children: b.lines.map(function(l, k){ return new D.TextRun(k ? { text: l, break: 1 } : { text: l }); }) })];
      case 'list': {
        olInstance++;
        return b.items.map(function(it){
          if (it.task !== null) {
            return new D.Paragraph({
              style: style, indent: { left: 360 + it.level * 360, hanging: 300 }, spacing: { after: 40 },
              children: [new D.TextRun({ text: it.task ? '☑ ' : '☐ ' })].concat(textRuns(it.text, it.task ? { strike: true, color: MUTED } : {}))
            });
          }
          var opt = { style: style, children: textRuns(it.text), spacing: { after: 40 } };
          if (it.ordered) opt.numbering = { reference: 'wiki-ol', level: it.level, instance: olInstance };
          else opt.bullet = { level: it.level };
          return new D.Paragraph(opt);
        });
      }
      case 'table': {
        var n = b.head.length, colW = Math.floor(9300 / n);
        function row(cellsArr, header){
          return new D.TableRow({
            tableHeader: header,
            children: cellsArr.map(function(c){
              return new D.TableCell({
                width: { size: colW, type: D.WidthType.DXA },
                shading: header ? SHADE : undefined,
                margins: { top: 60, bottom: 60, left: 100, right: 100 },
                children: [new D.Paragraph({ spacing: { after: 0, line: 260 }, children: textRuns(c, header ? { bold: true } : {}) })]
              });
            })
          });
        }
        return [
          new D.Table({
            width: { size: 100, type: D.WidthType.PERCENTAGE },
            columnWidths: b.head.map(function(){ return colW; }),
            borders: { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER, insideHorizontal: BORDER, insideVertical: BORDER },
            rows: [row(b.head, true)].concat(b.rows.map(function(r){ return row(r, false); }))
          }),
          new D.Paragraph({ children: [], spacing: { after: 120 } })
        ];
      }
    }
    return [];
  }

  var body = [];
  flat(parse(page.body)).forEach(function(b){ body = body.concat(render(b)); });

  var doc = new D.Document({
    creator: ctx.by || '팀 위키',
    title: page.title || '제목 없음',
    description: '팀 위키에서 내보낸 문서',
    styles: {
      default: {
        document: { run: { font: FONTS, size: 21, color: TEXT }, paragraph: { spacing: { after: 120, line: 300 } } },
        title: { run: { font: FONTS, size: 44, bold: true, color: TEXT }, paragraph: { spacing: { after: 60 } } },
        heading1: { run: { font: FONTS, size: 32, bold: true, color: TEXT }, paragraph: { spacing: { before: 360, after: 120 } } },
        heading2: { run: { font: FONTS, size: 28, bold: true, color: TEXT }, paragraph: { spacing: { before: 300, after: 100 } } },
        heading3: { run: { font: FONTS, size: 24, bold: true, color: TEXT }, paragraph: { spacing: { before: 240, after: 80 } } }
      },
      paragraphStyles: [
        { id: 'WikiCode', name: 'Wiki Code', basedOn: 'Normal', run: { font: CODE, size: 19 },
          paragraph: { spacing: { after: 120, line: 260 }, shading: SHADE, indent: { left: 120, right: 120 } } },
        { id: 'WikiQuote', name: 'Wiki Quote', basedOn: 'Normal', run: { color: '444444' },
          paragraph: { indent: { left: 240 }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'E8F0FD' },
            border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } } } },
        { id: 'WikiMeta', name: 'Wiki Meta', basedOn: 'Normal', run: { color: MUTED, size: 18 }, paragraph: { spacing: { after: 300 } } }
      ]
    },
    numbering: {
      config: [{
        reference: 'wiki-ol',
        levels: [0, 1, 2, 3, 4].map(function(l){
          return { level: l, format: D.LevelFormat.DECIMAL, text: '%' + (l + 1) + '.', alignment: D.AlignmentType.START,
            style: { paragraph: { indent: { left: 360 + l * 360, hanging: 300 } } } };
        })
      }]
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, right: 1260, bottom: 1440, left: 1260 } } },
      children: [
        new D.Paragraph({ heading: D.HeadingLevel.TITLE, children: [new D.TextRun(page.title || '제목 없음')] }),
        new D.Paragraph({ style: 'WikiMeta', children: [new D.TextRun(metaLine(ctx))] })
      ].concat(body)
    }]
  });
  return D.Packer.toBase64String(doc).then(b64ToBytes);
}

/* ---------- Excel (.xlsx) : SheetJS ---------- */
// 표 1개 = 시트 1개, 할 일 목록 = "할 일" 시트, 마지막에 "문서 정보" 시트
function buildXlsx(page, ctx, X){
  var blocks = flat(parse(page.body)), sheets = [], tasks = [], section = page.title || '표';
  function val(s){ var t = plain(s); return /^-?(0|[1-9]\d{0,13})(\.\d+)?$/.test(t) ? +t : t; }
  blocks.forEach(function(b){
    if (b.t === 'h') section = plain(b.text);
    else if (b.t === 'table') sheets.push({ name: section, rows: [b.head.map(plain)].concat(b.rows.map(function(r){ return r.map(val); })) });
    else if (b.t === 'list') b.items.forEach(function(it){ if (it.task !== null) tasks.push([it.task ? '완료' : '미완료', plain(it.text), section]); });
  });
  if (tasks.length) sheets.push({ name: '할 일', rows: [['상태', '항목', '구분']].concat(tasks) });
  if (!sheets.length) {
    // 표도 할 일도 없으면 본문을 줄 단위로 담는다
    var rows = [['구분', '내용']];
    blocks.forEach(function(b){
      if (b.t === 'h') rows.push(['제목', plain(b.text)]);
      else if (b.t === 'p') b.lines.forEach(function(l){ rows.push(['본문', plain(l)]); });
      else if (b.t === 'list') b.items.forEach(function(it){ rows.push(['목록', new Array(it.level + 1).join('  ') + plain(it.text)]); });
      else if (b.t === 'code') rows.push(['코드', b.lines.join('\n')]);
    });
    sheets.push({ name: '본문', rows: rows });
  }
  sheets.push({ name: '문서 정보', rows: [['항목', '내용'], ['제목', page.title || '제목 없음'], ['위치', ctx.path || ''], ['마지막 수정', ctx.updated || ''], ['작성자', ctx.by || '']], noFilter: true });

  var wb = X.utils.book_new(), used = {};
  sheets.forEach(function(s){
    var ws = X.utils.aoa_to_sheet(s.rows), ncol = 0;
    s.rows.forEach(function(r){ ncol = Math.max(ncol, r.length); });
    ws['!cols'] = [];
    for (var c = 0; c < ncol; c++) {
      var w = 6;
      s.rows.forEach(function(r){ String(r[c] == null ? '' : r[c]).split('\n').forEach(function(t){ w = Math.max(w, width(t)); }); });
      ws['!cols'].push({ wch: Math.min(w + 2, 60) });
    }
    if (!s.noFilter && s.rows.length > 1) ws['!autofilter'] = { ref: X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: s.rows.length - 1, c: ncol - 1 } }) };
    // 시트 이름: 31자 이내, []:*?/\ 사용 불가, 중복 불가
    var base = s.name.replace(/[\[\]:*?\/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 28) || '시트', name = base, k = 2;
    while (used[name.toLowerCase()]) name = base + ' (' + (k++) + ')';
    used[name.toLowerCase()] = 1;
    X.utils.book_append_sheet(wb, ws, name);
  });
  wb.Props = { Title: page.title || '제목 없음', Author: ctx.by || '팀 위키' };
  return Promise.resolve(new Uint8Array(X.write(wb, { bookType: 'xlsx', type: 'array', compression: true })));
}

/* ---------- PowerPoint (.pptx) : PptxGenJS ---------- */
// 표지 1장 + "#", "##" 제목마다 슬라이드. 내용이 넘치면 "(계속)" 슬라이드로 나눈다.
function buildPptx(page, ctx, P){
  var pptx = new P();
  pptx.layout = 'LAYOUT_WIDE';   // 13.33 x 7.5 in
  pptx.author = ctx.by || '팀 위키';
  pptx.title = page.title || '제목 없음';
  pptx.theme = { headFontFace: FONT, bodyFontFace: FONT };
  var X0 = 0.6, W = 12.13, TOP = 1.45, BOTTOM = 6.75, LINE_H = 0.42, ROW_H = 0.42, PER_LINE = 92;
  var RECT = pptx.ShapeType ? pptx.ShapeType.rect : 'rect', made = 1;

  pptx.defineSlideMaster({
    title: 'WIKI',
    background: { color: 'FFFFFF' },
    objects: [{ text: { text: page.title || '', options: { x: X0, y: 6.95, w: 9, h: 0.35, fontSize: 10, color: '9AA0A6', fontFace: FONT } } }],
    slideNumber: { x: 12.1, y: 6.95, w: 0.7, h: 0.35, fontSize: 10, color: '9AA0A6', fontFace: FONT, align: 'right' }
  });

  // 표지
  var cover = pptx.addSlide();
  cover.background = { color: 'FFFFFF' };
  cover.addShape(RECT, { x: 0, y: 0, w: 0.25, h: 7.5, fill: { color: ACCENT }, line: { color: ACCENT } });
  cover.addText(page.title || '제목 없음', { x: 1.0, y: 2.4, w: 11.3, h: 1.4, fontSize: 40, bold: true, color: TEXT, fontFace: FONT, valign: 'bottom' });
  cover.addText(metaLine(ctx), { x: 1.0, y: 3.95, w: 11.3, h: 0.6, fontSize: 16, color: MUTED, fontFace: FONT, valign: 'top' });

  function para(s, opt, base){
    base = base || {};
    var rs = runs(s); if (!rs.length) rs = [{ text: '' }];
    return rs.map(function(r, k){
      var o = { bullet: opt.bullet || false, indentLevel: opt.indentLevel || 0, paraSpaceAfter: 4, fontSize: base.fontSize || 18,
        bold: !!(r.b || base.bold), italic: !!(r.i || base.italic),
        color: base.color || ((r.url || r.wiki) ? ACCENT : TEXT), fontFace: r.code || base.code ? 'Consolas' : FONT };
      if (r.s || base.strike) o.strike = 'sngStrike';
      if (r.url || r.wiki) o.underline = { style: 'sng' };
      if (r.url) o.hyperlink = { url: r.url };
      if (k === rs.length - 1) o.breakLine = true;
      return { text: r.text, options: o };
    });
  }
  function lines(s, perLine){ return Math.max(1, Math.ceil(width(plain(s)) / (perLine || PER_LINE))); }

  // 1) 블록을 섹션(슬라이드 제목 단위)으로 나누고, 각 섹션을 텍스트/표 항목으로 바꾼다
  var sections = [], sec = { title: page.title || '내용', items: [] };
  sections.push(sec);
  flat(parse(page.body)).forEach(function(b){
    var base = b.quote ? { italic: true, color: '555555' } : {};
    if (b.t === 'h' && b.level <= 2) { sec = { title: plain(b.text), items: [] }; sections.push(sec); return; }
    if (b.t === 'h') sec.items.push({ kind: 'text', paras: [para(b.text, {}, { bold: true, color: ACCENT, fontSize: 20 })], lines: lines(b.text) });
    else if (b.t === 'p') b.lines.forEach(function(l){ sec.items.push({ kind: 'text', paras: [para(l, {}, base)], lines: lines(l) }); });
    else if (b.t === 'code') b.lines.forEach(function(l){ sec.items.push({ kind: 'text', paras: [para('`' + l.replace(/`/g, "'") + '`', {}, { fontSize: 14, code: true })], lines: 0.8 }); });
    else if (b.t === 'list') b.items.forEach(function(it){
      var opt = { indentLevel: it.level }, text = it.text, extra = {};
      if (it.task !== null) { text = (it.task ? '☑ ' : '☐ ') + text; if (it.task) extra = { strike: true, color: MUTED }; }
      else opt.bullet = it.ordered ? { type: 'number' } : true;
      sec.items.push({ kind: 'text', paras: [para(text, opt, Object.assign({}, base, extra))], lines: lines(text, PER_LINE - it.level * 6) });
    });
    else if (b.t === 'table') sec.items.push({ kind: 'table', head: b.head, rows: b.rows });
  });

  // 2) 섹션마다 슬라이드에 배치
  sections.forEach(function(s, si){
    if (!s.items.length && (si === 0 || sections.length > 1)) return;
    var slide = null, y = TOP, count = 0, pend = [], pendH = 0;
    function open(){
      if (slide) return;
      slide = pptx.addSlide({ masterName: 'WIKI' }); made++;
      slide.addShape(RECT, { x: X0, y: 0.5, w: 0.08, h: 0.62, fill: { color: ACCENT }, line: { color: ACCENT } });
      slide.addText(s.title + (count++ ? ' (계속)' : ''), { x: X0 + 0.22, y: 0.4, w: W - 0.22, h: 0.82, fontSize: 28, bold: true, color: TEXT, fontFace: FONT, valign: 'middle' });
      y = TOP;
    }
    function flushText(){
      if (!pend.length) return;
      open();
      var objs = [].concat.apply([], pend);
      delete objs[objs.length - 1].options.breakLine;
      slide.addText(objs, { x: X0, y: y, w: W, h: pendH, valign: 'top', fontFace: FONT, fontSize: 18, color: TEXT, margin: 0.05 });
      y += pendH; pend = []; pendH = 0;
    }
    function next(){ flushText(); slide = null; }
    s.items.forEach(function(it){
      if (it.kind === 'text') {
        var h = it.lines * LINE_H;
        if ((slide ? y : TOP) + pendH + h > BOTTOM && (pend.length || (slide && y > TOP))) next();
        pend.push(it.paras[0]); pendH += h;
        return;
      }
      // 표: 남은 공간에 들어가는 행만큼 잘라 넣고, 나머지는 머리글을 반복해 "(계속)" 슬라이드로
      var cell = function(c, header){
        return { text: plain(c), options: header ? { bold: true, fill: { color: CODE_BG }, color: TEXT } : { color: TEXT } };
      };
      var head = it.head.map(function(c){ return cell(c, true); });
      var left = it.rows.map(function(r){ return r.map(function(c){ return cell(c, false); }); });
      flushText(); open();
      if (y + Math.min(left.length + 1, 3) * ROW_H > BOTTOM) { next(); open(); }
      do {
        var cap = Math.max(1, Math.floor((BOTTOM - y) / ROW_H) - 1), chunk = left.splice(0, cap);
        slide.addTable([head].concat(chunk), {
          x: X0, y: y, w: W, fontFace: FONT, fontSize: 14, valign: 'middle', margin: 0.06,
          border: { type: 'solid', pt: 0.75, color: LINE }, rowH: ROW_H
        });
        y += (chunk.length + 1) * ROW_H + 0.2;
        if (left.length) { next(); open(); }
      } while (left.length);
    });
    flushText();
  });
  if (made === 1) {
    var empty = pptx.addSlide({ masterName: 'WIKI' });
    empty.addText('내용이 없습니다', { x: X0, y: 3, w: W, h: 1, fontSize: 20, color: MUTED, align: 'center', fontFace: FONT });
  }
  return pptx.write({ outputType: 'uint8array' });
}

return {
  parse: parse,
  build: function(fmt, page, ctx, lib){
    ctx = ctx || {};
    if (fmt === 'docx') return buildDocx(page, ctx, lib);
    if (fmt === 'xlsx') return buildXlsx(page, ctx, lib);
    if (fmt === 'pptx') return buildPptx(page, ctx, lib);
    return Promise.reject(new Error('지원하지 않는 형식: ' + fmt));
  }
};
});
