import { Readable } from "stream";
import { load as loadHtml } from "cheerio";
import { convert } from "html-to-text";
import * as mammoth from "mammoth";
import csvParser from "csv-parser";
import * as XLSX from "xlsx";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.js";
import { DocumentExtractInput } from "./types";

type CellValue = string | number | boolean | Date | null;
type Row = Record<string, CellValue>;

export class DocumentExtractService {
  async extract(input: DocumentExtractInput): Promise<Record<string, unknown>> {
    const common = {
      success: true,
      sourceUrl: input.sourceUrl,
      format: input.format,
      mimeType: input.mimeType,
      fileName: input.fileName,
      sizeBytes: input.sizeBytes,
    };

    switch (input.format) {
      case "pdf":
        return { ...common, ...(await this.extractPdf(input.buffer)) };
      case "html":
        return { ...common, ...this.extractHtml(input.buffer) };
      case "docx":
        return { ...common, ...(await this.extractDocx(input.buffer)) };
      case "xlsx":
      case "xls":
        return { ...common, ...this.extractWorkbook(input.buffer) };
      case "csv":
        return { ...common, ...(await this.extractCsv(input.buffer)) };
      case "text":
      default:
        return { ...common, text: input.buffer.toString("utf8") };
    }
  }

  private async extractPdf(buffer: Buffer): Promise<Record<string, unknown>> {
    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
      useWorkerFetch: false,
      isEvalSupported: false,
    });
    const pdf = await loadingTask.promise;
    const pages: Array<{ pageNumber: number; text: string }> = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .trim();
      pages.push({ pageNumber, text });
    }

    const metadataResult = await pdf.getMetadata().catch(() => undefined);
    const metadataInfo = metadataResult?.info as { Title?: string } | undefined;

    return {
      text: pages.map((page) => page.text).join("\n\n"),
      pages,
      metadata: { title: metadataInfo?.Title, pageCount: pdf.numPages },
    };
  }

  private extractHtml(buffer: Buffer): Record<string, unknown> {
    const html = buffer.toString("utf8");
    const $ = loadHtml(html);
    const title = $("title").first().text().trim() || undefined;

    return {
      text: convert(html, {
        wordwrap: false,
        selectors: [
          { selector: "script", format: "skip" },
          { selector: "style", format: "skip" },
        ],
      }),
      title,
    };
  }

  private async extractDocx(buffer: Buffer): Promise<Record<string, unknown>> {
    const result = await mammoth.extractRawText({ buffer });
    return { text: result.value, metadata: {} };
  }

  private extractWorkbook(buffer: Buffer): Record<string, unknown> {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheets = workbook.SheetNames.map((name) => ({
      name,
      rows: XLSX.utils.sheet_to_json<Row>(workbook.Sheets[name], { defval: null }),
    }));

    return { sheets };
  }

  private async extractCsv(buffer: Buffer): Promise<Record<string, unknown>> {
    const rows: Row[] = [];
    const columns = new Set<string>();

    await new Promise<void>((resolve, reject) => {
      Readable.from(buffer)
        .pipe(csvParser())
        .on("data", (row: Row) => {
          rows.push(row);
          Object.keys(row).forEach((column) => columns.add(column));
        })
        .on("end", resolve)
        .on("error", reject);
    });

    return { rows, columns: Array.from(columns) };
  }
}
