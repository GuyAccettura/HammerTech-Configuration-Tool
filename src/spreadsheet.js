import { readFile } from "node:fs/promises";
import { extname } from "node:path";

export async function readSpreadsheetRows(filePath, { sheet } = {}) {
  const buffer = await readFile(filePath);
  return readSpreadsheetRowsFromBuffer(filePath, buffer, { sheet });
}

export async function readSpreadsheetRowsFromBuffer(fileName, buffer, { sheet } = {}) {
  const extension = extname(fileName).toLowerCase();
  if (extension === ".csv" || extension === ".txt") {
    const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : Buffer.from(buffer).toString("utf8");
    return normalizeRows(parseCsv(text));
  }

  if (extension === ".xlsx" || extension === ".xlsm") {
    let ExcelJS;
    try {
      ExcelJS = (await import("exceljs")).default;
    } catch (error) {
      throw new Error("Reading Excel files requires the exceljs package. Run npm install first.");
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const worksheet = sheet ? workbook.getWorksheet(sheet) : workbook.worksheets[0];
    if (!worksheet) {
      throw new Error(`Sheet "${sheet || ""}" was not found. Available sheets: ${workbook.worksheets.map((item) => item.name).join(", ")}.`);
    }
    return normalizeRows(worksheetToObjects(worksheet));
  }

  if (extension === ".xls") {
    throw new Error("Legacy .xls files are not supported. Save the workbook as .xlsx or .csv first.");
  }

  throw new Error(`Unsupported spreadsheet type "${extension}". Use .csv, .xlsx, or .xlsm.`);
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (inQuotes) {
      if (char === "\"" && next === "\"") {
        cell += "\"";
        index += 1;
      } else if (char === "\"") {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
      continue;
    }

    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }

    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\r") continue;
    cell += char;
  }

  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((values) => {
    const object = {};
    headers.forEach((header, index) => {
      object[header] = values[index] ?? "";
    });
    return object;
  });
}

function normalizeRows(rows) {
  return rows
    .map((row) => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        normalized[String(key || "").trim()] = typeof value === "string" ? value.trim() : value;
      }
      return normalized;
    })
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));
}

function worksheetToObjects(worksheet) {
  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    headers[columnNumber - 1] = cellToString(cell).trim();
  });

  const rows = [];
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const object = {};
    headers.forEach((header, index) => {
      if (!header) return;
      object[header] = cellToString(row.getCell(index + 1));
    });
    rows.push(object);
  });
  return rows;
}

function cellToString(cell) {
  const value = cell?.value;
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return String(value.result ?? "");
    if ("text" in value) return String(value.text ?? "");
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text || "").join("");
    if ("hyperlink" in value && "text" in value) return String(value.text ?? "");
  }
  return String(value);
}
