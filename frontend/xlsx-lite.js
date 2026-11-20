/* Zebra Dormus Inn: a small Excel (.xlsx) file writer for the dashboard's reports.
   No outside library: an .xlsx file is a zip of a few XML files, written here directly.

   ZDXlsx.download("report.xlsx", [
       { name: "Items", cols: [24, 12], freeze: 1, rows: [
           [{ v: "Item", s: "head" }, { v: "Value", s: "head" }],
           ["Soap", { v: 1200, s: "money" }],
           [{ v: "Total", s: "bold" }, { v: 1200, s: "moneyTotal", f: "SUM(B2:B2)" }]
       ] }
   ]);

   A cell is a plain value (text or number), null for an empty cell, or { v, s, f }:
   v the value, s the style (below), f an Excel formula (v is then its result, shown until Excel recalculates).
   Text is always stored as text, so a name that starts with "=" never runs as a formula. */
(function () {
    "use strict";

    /* Styles: the position in cellXfs in styles.xml below */
    var STYLE = {
        normal: 0, head: 1, money: 2, bold: 3, moneyTotal: 4, title: 5, note: 6, date: 7, pct: 8,
        total: 9, numberTotal: 10, wrap: 11, subtitle: 12
    };

    var STYLES_XML =
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<numFmts count="3">' +
        '<numFmt numFmtId="164" formatCode="&quot;RWF &quot;#,##0;&quot;-RWF &quot;#,##0;&quot;RWF &quot;0"/>' +
        '<numFmt numFmtId="165" formatCode="d mmm yyyy"/>' +
        '<numFmt numFmtId="166" formatCode="+0%;-0%;0%"/>' +
        '</numFmts>' +
        '<fonts count="6">' +
        '<font><sz val="11"/><name val="Arial"/><family val="2"/></font>' +
        '<font><b/><sz val="11"/><name val="Arial"/><family val="2"/></font>' +
        '<font><b/><sz val="15"/><name val="Arial"/><family val="2"/></font>' +
        '<font><i/><sz val="10"/><color rgb="FF666666"/><name val="Arial"/><family val="2"/></font>' +
        '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/><family val="2"/></font>' +
        '<font><b/><sz val="12"/><name val="Arial"/><family val="2"/></font>' +
        '</fonts>' +
        '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FF111111"/><bgColor indexed="64"/></patternFill></fill>' +
        '</fills>' +
        '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left/><right/><top style="thin"><color rgb="FF111111"/></top><bottom style="thin"><color rgb="FF111111"/></bottom><diagonal/></border>' +
        '</borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="13">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +                                                     // normal
        '<xf numFmtId="0" fontId="4" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>' + // head
        '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                           // money
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // bold
        '<xf numFmtId="164" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' + // moneyTotal
        '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // title
        '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // note
        '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left"/></xf>' + // date
        '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +                           // pct
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +                     // total (label)
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +                     // numberTotal
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' + // wrap
        '<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +                                     // subtitle
        '</cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '</styleSheet>';

    function xml(text) {
        return String(text)
            .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function column(index) { // 0 -> A, 25 -> Z, 26 -> AA
        var name = "";
        index += 1;
        while (index > 0) {
            var rest = (index - 1) % 26;
            name = String.fromCharCode(65 + rest) + name;
            index = Math.floor((index - 1) / 26);
        }
        return name;
    }

    function cellXml(cell, ref) {
        if (cell === null || cell === undefined || cell === "") return "";
        var c = typeof cell === "object" ? cell : { v: cell };
        var s = c.s && STYLE[c.s] ? ' s="' + STYLE[c.s] + '"' : "";
        var v = c.v;

        if (c.f) {
            var result = typeof v === "number" && isFinite(v) ? "<v>" + v + "</v>" : "";
            return '<c r="' + ref + '"' + s + "><f>" + xml(c.f) + "</f>" + result + "</c>";
        }
        if (typeof v === "number") {
            if (!isFinite(v)) return "";
            return '<c r="' + ref + '"' + s + "><v>" + v + "</v></c>";
        }
        if (v === null || v === undefined || v === "") {
            return s ? '<c r="' + ref + '"' + s + "/>" : "";
        }
        return '<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' + xml(v) + "</t></is></c>";
    }

    function sheetXml(sheet) {
        var out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
            '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';

        out += '<sheetViews><sheetView workbookViewId="0"' + (sheet.first ? ' tabSelected="1"' : "") + ">";
        if (sheet.freeze) {
            out += '<pane ySplit="' + sheet.freeze + '" topLeftCell="A' + (sheet.freeze + 1) + '" activePane="bottomLeft" state="frozen"/>';
        }
        out += "</sheetView></sheetViews>";
        out += '<sheetFormatPr defaultRowHeight="15"/>';

        if (sheet.cols && sheet.cols.length) {
            out += "<cols>";
            sheet.cols.forEach(function (width, i) {
                out += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>';
            });
            out += "</cols>";
        }

        out += "<sheetData>";
        sheet.rows.forEach(function (row, r) {
            var cells = (row || []).map(function (cell, c) { return cellXml(cell, column(c) + (r + 1)); }).join("");
            out += '<row r="' + (r + 1) + '">' + cells + "</row>";
        });
        out += "</sheetData>";
        out += '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
        out += '<pageSetup paperSize="9" orientation="' + (sheet.landscape ? "landscape" : "portrait") + '" fitToWidth="1" fitToHeight="0"/>';
        if (sheet.footer) {
            out += '<headerFooter><oddFooter>' + xml("&L" + sheet.footer + "&RPage &P of &N") + "</oddFooter></headerFooter>";
        }
        out += "</worksheet>";
        return out;
    }

    /* ----- zip, "stored" (no compression): enough for a report ----- */

    var CRC_TABLE = (function () {
        var table = new Uint32Array(256);
        for (var n = 0; n < 256; n += 1) {
            var c = n;
            for (var k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes) {
        var crc = 0xFFFFFFFF;
        for (var i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
        return (crc ^ 0xFFFFFFFF) >>> 0;
    }

    function zip(files) {
        var encoder = new TextEncoder();
        var now = new Date();
        var dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
        var dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

        var parts = [];
        var central = [];
        var offset = 0;

        files.forEach(function (file) {
            var name = encoder.encode(file.name);
            var data = encoder.encode(file.text);
            var crc = crc32(data);

            var local = new DataView(new ArrayBuffer(30));
            local.setUint32(0, 0x04034b50, true);
            local.setUint16(4, 20, true);
            local.setUint16(6, 0x0800, true); // names are UTF-8
            local.setUint16(8, 0, true); // stored
            local.setUint16(10, dosTime, true);
            local.setUint16(12, dosDate, true);
            local.setUint32(14, crc, true);
            local.setUint32(18, data.length, true);
            local.setUint32(22, data.length, true);
            local.setUint16(26, name.length, true);
            local.setUint16(28, 0, true);
            parts.push(new Uint8Array(local.buffer), name, data);

            var entry = new DataView(new ArrayBuffer(46));
            entry.setUint32(0, 0x02014b50, true);
            entry.setUint16(4, 20, true);
            entry.setUint16(6, 20, true);
            entry.setUint16(8, 0x0800, true);
            entry.setUint16(10, 0, true);
            entry.setUint16(12, dosTime, true);
            entry.setUint16(14, dosDate, true);
            entry.setUint32(16, crc, true);
            entry.setUint32(20, data.length, true);
            entry.setUint32(24, data.length, true);
            entry.setUint16(28, name.length, true);
            entry.setUint16(30, 0, true);
            entry.setUint16(32, 0, true);
            entry.setUint16(34, 0, true);
            entry.setUint16(36, 0, true);
            entry.setUint32(38, 0, true);
            entry.setUint32(42, offset, true);
            central.push(new Uint8Array(entry.buffer), name);

            offset += 30 + name.length + data.length;
        });

        var centralSize = central.reduce(function (sum, part) { return sum + part.length; }, 0);
        var end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(4, 0, true);
        end.setUint16(6, 0, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, centralSize, true);
        end.setUint32(16, offset, true);
        end.setUint16(20, 0, true);

        return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        });
    }

    function sheetName(name, used) {
        var clean = String(name || "Sheet").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Sheet";
        var unique = clean;
        var n = 2;
        while (used.indexOf(unique.toLowerCase()) >= 0) {
            unique = clean.slice(0, 28) + " " + n;
            n += 1;
        }
        used.push(unique.toLowerCase());
        return unique;
    }

    function build(sheets) {
        var used = [];
        var names = sheets.map(function (sheet) { return sheetName(sheet.name, used); });
        var files = [];

        files.push({
            name: "[Content_Types].xml",
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
                '<Default Extension="xml" ContentType="application/xml"/>' +
                '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
                '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
                sheets.map(function (sheet, i) {
                    return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
                }).join("") +
                "</Types>"
        });

        files.push({
            name: "_rels/.rels",
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
                "</Relationships>"
        });

        files.push({
            name: "xl/workbook.xml",
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
                '<bookViews><workbookView activeTab="0"/></bookViews><sheets>' +
                names.map(function (name, i) {
                    return '<sheet name="' + xml(name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
                }).join("") +
                '</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>'
        });

        files.push({
            name: "xl/_rels/workbook.xml.rels",
            text: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
                sheets.map(function (sheet, i) {
                    return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>';
                }).join("") +
                '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
                "</Relationships>"
        });

        files.push({ name: "xl/styles.xml", text: STYLES_XML });

        sheets.forEach(function (sheet, i) {
            files.push({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", text: sheetXml(Object.assign({ first: i === 0 }, sheet)) });
        });

        return zip(files);
    }

    function download(fileName, sheets) {
        var blob = build(sheets);
        var link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        setTimeout(function () {
            URL.revokeObjectURL(link.href);
            link.remove();
        }, 1000);
    }

    /* an Excel date number for a day like 2026-11-20 */
    function excelDay(text) {
        var parts = String(text).split("-").map(Number);
        return Math.round((Date.UTC(parts[0], parts[1] - 1, parts[2]) - Date.UTC(1899, 11, 30)) / 86400000);
    }

    window.ZDXlsx = { build: build, download: download, column: column, excelDay: excelDay };
})();
