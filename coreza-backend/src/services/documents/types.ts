export type DocumentFormat = "pdf" | "html" | "docx" | "xlsx" | "xls" | "csv" | "text";

export interface DownloadedDocument {
  buffer: Buffer;
  mimeType?: string;
  fileName?: string;
  contentDisposition?: string;
  finalUrl: string;
  sizeBytes: number;
}

export interface DocumentExtractInput {
  buffer: Buffer;
  format: DocumentFormat;
  mimeType?: string;
  fileName?: string;
  sourceUrl: string;
  sizeBytes: number;
}
