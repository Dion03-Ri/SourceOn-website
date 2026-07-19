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
    gold:   'E8A020',
    light:  'F1F5F9',
    muted:  '6B7C99',
    line:   '1E3A5F'
  };
  var thin = { style: 'thin', color: { rgb: C.line } };

  var SO_XL = {
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

  function soExcelExport(filename, sheets) {
    var XLSX = global.XLSX;
    if (!XLSX || !XLSX.utils) {
      alert('Excel-Bibliothek noch nicht geladen — bitte einen Moment warten und erneut versuchen.');
      return false;
    }
    var wb = XLSX.utils.book_new();
    sheets.forEach(function (def) {
      var ws = buildSheet(def);
      XLSX.utils.book_append_sheet(wb, ws, def.name.slice(0, 31));
    });
    XLSX.writeFile(wb, filename);
    return true;
  }

  global.SO_XL = SO_XL;
  global.soCell = soCell;
  global.soExcelExport = soExcelExport;
})(window);
