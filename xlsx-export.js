/* SourceOn — shared professional Excel export helper.
 * Uses xlsx-js-style (a drop-in SheetJS fork that supports cell styling; the
 * plain community xlsx build silently drops fills/fonts/borders). Exposes the
 * same global `XLSX`. Loaded via CDN in the dashboards that export.
 *
 * Usage:
 *   soExcelExport('file.xlsx', [
 *     { name:'Übersicht', cols:[45,14,...], merges:[{s:{r:0,c:0},e:{r:0,c:5}}],
 *       rows:[ [ soCell('Titel', SO_XL.title), ... ], ... ] }
 *   ]);
 *
 * A cell is either a plain value or a descriptor {v, s, z, t}:
 *   v = value, s = style object, z = number format, t = 'n'|'s' cell type.
 */
(function (global) {
  // Brand palette (ARGB without the leading '#', as xlsx-js-style expects).
  var C = {
    ink:    '070F1A', // deepest navy  (title bg / data row A)
    panel:  '0C1824', // panel navy    (header bg / data row B)
    total:  '111F2E', // total-row bg
    gold:   'D99000',
    light:  'F1F5F9',
    muted:  '6B7C99',
    line:   '1E3A5F'
  };
  var thin = { style: 'thin', color: { rgb: C.line } };

  // Real SourceOn company data (from the Impressum). No UID/VAT number is
  // invented — the company is still in formation, so it is marked honestly.
  var SO_COMPANY = {
    name: 'SourceOn GmbH',
    addr: 'Musterstrasse 1',
    city: '8001 Zürich',
    country: 'Schweiz',
    mail: 'info@sourceon.ch',
    web:  'www.sourceon.ch',
    uid:  'CHE-XXX.XXX.XXX (in Gründung)',
    iban: 'CH00 0000 0000 0000 0000 0 (folgt)',
    vatRate: 0.081 // Swiss standard VAT rate (8.1%)
  };

  var SO_XL = {
    company: SO_COMPANY,
    // Big gold wordmark for the document header.
    brand: {
      font: { bold: true, sz: 26, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    brandTag: {
      font: { sz: 9, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'left', vertical: 'top' }
    },
    // Document type (e.g. "Provisionsabrechnung"), right side of header.
    docType: {
      font: { bold: true, sz: 15, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'right', vertical: 'center' }
    },
    docMeta: {
      font: { sz: 9, color: { rgb: C.muted } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'right', vertical: 'top' }
    },
    // Address blocks (Von / An).
    addrLabel: {
      font: { bold: true, sz: 8, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.panel } },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    addrText: {
      font: { sz: 10, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.panel } },
      alignment: { horizontal: 'left', vertical: 'top', wrapText: true }
    },
    sectionLabel: {
      font: { bold: true, sz: 10, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    // Summary block (right-aligned label + value).
    sumLabel: {
      font: { sz: 10, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'right', vertical: 'center' }
    },
    sumVal: {
      font: { sz: 10, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'right', vertical: 'center' }
    },
    sumTotalLabel: {
      font: { bold: true, sz: 12, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.total } },
      alignment: { horizontal: 'right', vertical: 'center' },
      border: { top: { style: 'medium', color: { rgb: C.gold } } }
    },
    sumTotalVal: {
      font: { bold: true, sz: 12, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.total } },
      alignment: { horizontal: 'right', vertical: 'center' },
      border: { top: { style: 'medium', color: { rgb: C.gold } } }
    },
    title: {
      font: { bold: true, sz: 16, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    subtitle: {
      font: { sz: 10, color: { rgb: C.muted } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'left', vertical: 'center' }
    },
    header: {
      font: { bold: true, sz: 11, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.panel } },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
      border: { bottom: { style: 'medium', color: { rgb: C.gold } } }
    },
    headerNum: {
      font: { bold: true, sz: 11, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.panel } },
      alignment: { horizontal: 'right', vertical: 'center', wrapText: true },
      border: { bottom: { style: 'medium', color: { rgb: C.gold } } }
    },
    dataA: {
      font: { sz: 10, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { vertical: 'center' },
      border: { bottom: thin }
    },
    dataB: {
      font: { sz: 10, color: { rgb: C.light } },
      fill: { fgColor: { rgb: C.panel } },
      alignment: { vertical: 'center' },
      border: { bottom: thin }
    },
    total: {
      font: { bold: true, sz: 11, color: { rgb: C.gold } },
      fill: { fgColor: { rgb: C.total } },
      alignment: { vertical: 'center' }
    },
    footer: {
      font: { italic: true, sz: 9, color: { rgb: C.muted } },
      fill: { fgColor: { rgb: C.ink } },
      alignment: { horizontal: 'left', vertical: 'center', wrapText: true }
    },
    // number formats
    Z_CHF: '#,##0.00" CHF"',
    Z_PCT: '0"%"',
    Z_INT: '#,##0'
  };

  // Right-aligned variants of the row styles (for numeric columns).
  function rightAlign(base) {
    var s = JSON.parse(JSON.stringify(base));
    s.alignment = s.alignment || {};
    s.alignment.horizontal = 'right';
    return s;
  }
  SO_XL.dataANum = rightAlign(SO_XL.dataA);
  SO_XL.dataBNum = rightAlign(SO_XL.dataB);
  SO_XL.totalNum = rightAlign(SO_XL.total);

  // Convenience: pick the alternating data style for a 0-based data-row index.
  SO_XL.rowStyle = function (i) { return (i % 2 === 0) ? SO_XL.dataA : SO_XL.dataB; };
  SO_XL.rowStyleNum = function (i) { return (i % 2 === 0) ? SO_XL.dataANum : SO_XL.dataBNum; };

  // ---- Document-layout builders --------------------------------------------
  // Push a row split into horizontal segments that tile the full width.
  // segs: [{ w: span, c: cellDescriptor }]. Remaining width is padded with the
  // last segment's style. Returns the 0-based row index.
  SO_XL.segRow = function (rows, merges, ncols, segs) {
    var r = rows.length, col = 0, row = [];
    segs.forEach(function (seg) {
      for (var i = 0; i < seg.w; i++) row.push(i === 0 ? seg.c : soCell('', seg.c.s));
      if (seg.w > 1) merges.push({ s: { r: r, c: col }, e: { r: r, c: col + seg.w - 1 } });
      col += seg.w;
    });
    var pad = segs.length ? segs[segs.length - 1].c.s : {};
    while (col < ncols) { row.push(soCell('', pad)); col++; }
    rows.push(row);
    return r;
  };

  // Full-width band (single merged cell across all columns).
  SO_XL.band = function (rows, merges, ncols, text, style) {
    return SO_XL.segRow(rows, merges, ncols, [{ w: ncols, c: soCell(text, style) }]);
  };

  // Summary line: right-aligned label spanning the left, value in the last cells.
  SO_XL.sumRow = function (rows, merges, ncols, label, value, z, lblStyle, valStyle) {
    var r = rows.length, row = [], lblEnd = ncols - 3;
    for (var c = 0; c < ncols; c++) {
      if (c === 0) row.push(soCell(label, lblStyle));
      else if (c === ncols - 2) row.push(soCell(value, valStyle, z, typeof value === 'number' ? 'n' : 's'));
      else row.push(soCell('', c <= lblEnd ? lblStyle : valStyle));
    }
    merges.push({ s: { r: r, c: 0 }, e: { r: r, c: lblEnd } });
    merges.push({ s: { r: r, c: ncols - 2 }, e: { r: r, c: ncols - 1 } });
    rows.push(row);
    return r;
  };

  // Branded document header: wordmark + document type, tagline + meta, and a
  // Von/An address pair. Returns the number of rows consumed.
  SO_XL.docHead = function (rows, merges, ncols, opts) {
    var half = Math.ceil(ncols / 2);
    var co = SO_COMPANY;
    SO_XL.segRow(rows, merges, ncols, [
      { w: half, c: soCell('SourceOn', SO_XL.brand) },
      { w: ncols - half, c: soCell(opts.docType, SO_XL.docType) }
    ]);
    SO_XL.segRow(rows, merges, ncols, [
      { w: half, c: soCell('Digitale Baustoff-Beschaffung · ' + co.web, SO_XL.brandTag) },
      { w: ncols - half, c: soCell((opts.meta || []).join('\n'), SO_XL.docMeta) }
    ]);
    rows.push([]);
    SO_XL.segRow(rows, merges, ncols, [
      { w: half, c: soCell('VON', SO_XL.addrLabel) },
      { w: ncols - half, c: soCell(opts.toLabel || 'AN', SO_XL.addrLabel) }
    ]);
    var fromLines = [co.name, co.addr, co.city + ', ' + co.country, co.mail, 'UID: ' + co.uid];
    SO_XL.segRow(rows, merges, ncols, [
      { w: half, c: soCell(fromLines.join('\n'), SO_XL.addrText) },
      { w: ncols - half, c: soCell((opts.toLines || []).join('\n'), SO_XL.addrText) }
    ]);
    rows.push([]);
  };

  // Build a cell descriptor.
  function soCell(v, s, z, t) {
    var c = { v: (v == null ? '' : v), s: s || {} };
    if (z) c.z = z;
    if (t) c.t = t;
    else if (typeof v === 'number') c.t = 'n';
    else c.t = 's';
    return c;
  }

  function buildSheet(def) {
    var XLSX = global.XLSX;
    var ws = {};
    var rows = def.rows || [];
    var maxCol = 0;
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r] || [];
      if (row.length > maxCol) maxCol = row.length;
      for (var c = 0; c < row.length; c++) {
        var cell = row[c];
        if (cell == null || cell === '') continue;
        if (typeof cell !== 'object' || !('v' in cell)) cell = soCell(cell);
        var addr = XLSX.utils.encode_cell({ r: r, c: c });
        ws[addr] = cell;
      }
    }
    ws['!ref'] = XLSX.utils.encode_range(
      { r: 0, c: 0 },
      { r: Math.max(rows.length - 1, 0), c: Math.max(maxCol - 1, 0) }
    );
    if (def.cols) ws['!cols'] = def.cols.map(function (w) { return { wch: w }; });
    if (def.merges) ws['!merges'] = def.merges;
    if (def.rowHeights) {
      ws['!rows'] = def.rowHeights.map(function (h) { return h ? { hpt: h } : {}; });
    }
    return ws;
  }

  // Lazy-Loader: die schwere xlsx-js-style-Bibliothek (~1 MB) wird erst beim
  // ersten Export nachgeladen, nicht schon beim Seitenaufbau.
  var XLSX_SRC = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
  var _xlsxLoading = null;
  function ensureXLSX() {
    if (global.XLSX && global.XLSX.utils) return Promise.resolve(true);
    if (_xlsxLoading) return _xlsxLoading;
    _xlsxLoading = new Promise(function (resolve, reject) {
      var sc = document.createElement('script');
      sc.src = XLSX_SRC;
      sc.async = true;
      sc.onload = function () { resolve(true); };
      sc.onerror = function () { _xlsxLoading = null; reject(new Error('xlsx_load_failed')); };
      document.head.appendChild(sc);
    });
    return _xlsxLoading;
  }

  function _buildAndWrite(filename, sheets) {
    var XLSX = global.XLSX;
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (def) {
      var ws = buildSheet(def);
      XLSX.utils.book_append_sheet(wb, ws, def.name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
    return true;
  }

  function soExcelExport(filename, sheets) {
    if (global.XLSX && global.XLSX.utils) {
      return Promise.resolve(_buildAndWrite(filename, sheets));
    }
    return ensureXLSX()
      .then(function () { return _buildAndWrite(filename, sheets); })
      .catch(function () {
        alert('Excel-Bibliothek konnte nicht geladen werden — bitte Internetverbindung prüfen und erneut versuchen.');
        return false;
      });
  }

  global.SO_XL = SO_XL;
  global.soCell = soCell;
  global.soExcelExport = soExcelExport;
  global.soEnsureXLSX = ensureXLSX;
})(window);
