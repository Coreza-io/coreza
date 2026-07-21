import { extname } from "path";
import { DocumentFormat, DownloadedDocument } from "./types";

const FORMAT_BY_MIME: Record<string, DocumentFormat> = {
  "application/pdf": "pdf",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "text/csv": "csv",
  "application/csv": "csv",
  "text/plain": "text",
};

const FORMAT_BY_EXTENSION: Record<string, DocumentFormat> = {
  ".pdf": "pdf",
  ".html": "html",
  ".htm": "html",
  ".docx": "docx",
  ".xlsx": "xlsx",
  ".xls": "xls",
  ".csv": "csv",
  ".txt": "text",
};

function formatFromName(name?: string): DocumentFormat | undefined {
  if (!name) return undefined;
  const ext = extname(name.split(/[?#]/)[0].toLowerCase());
  return FORMAT_BY_EXTENSION[ext];
}

function filenameFromDisposition(disposition?: string): string | undefined {
  if (!disposition) return undefined;
  const utfMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) return decodeURIComponent(utfMatch[1].replace(/"/g, ""));
  const asciiMatch = disposition.match(/filename="?([^";]+)"?/i);
  return asciiMatch?.[1]?.trim();
}

function detectZipOffice(buffer: Buffer): DocumentFormat | undefined {
  try {
    // Avoid adding a ZIP dependency just for detection: scan central-directory names.
    const ascii = buffer.toString("latin1");
    if (ascii.includes("word/")) return "docx";
    if (ascii.includes("xl/")) return "xlsx";
    if (ascii.includes("[Content_Types].xml")) {
      const contentTypesIndex = ascii.indexOf("[Content_Types].xml");
      const window = ascii.slice(Math.max(0, contentTypesIndex - 4096), contentTypesIndex + 4096);
      if (window.includes("wordprocessingml.document")) return "docx";
      if (window.includes("spreadsheetml.sheet")) return "xlsx";
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function detectFormat(document: DownloadedDocument & { contentDisposition?: string }): DocumentFormat {
  const { buffer, mimeType, fileName, finalUrl, contentDisposition } = document;
  const trimmedStart = buffer.subarray(0, 512).toString("utf8").trimStart().toLowerCase();

  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
    const officeFormat = detectZipOffice(buffer);
    if (officeFormat) return officeFormat;
  }
  if (buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0) return "xls";
  if (trimmedStart.startsWith("<html") || trimmedStart.startsWith("<!doctype html") || trimmedStart.startsWith("<")) return "html";

  const normalizedMime = mimeType?.split(";")[0]?.trim().toLowerCase();
  if (normalizedMime && FORMAT_BY_MIME[normalizedMime]) return FORMAT_BY_MIME[normalizedMime];

  return (
    formatFromName(fileName) ||
    formatFromName(filenameFromDisposition(contentDisposition)) ||
    formatFromName(new URL(finalUrl).pathname) ||
    "text"
  );
}

export { filenameFromDisposition };
