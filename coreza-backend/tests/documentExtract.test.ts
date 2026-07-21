import http from "http";
import { LookupAddress } from "dns";
import {
  DocumentDownloadService,
  DnsResolver,
  isBlockedHost,
  resolveAndCheck,
} from "../src/services/documents/DocumentDownloadService";
import { detectFormat } from "../src/services/documents/detectFormat";
import { DocumentExtractService } from "../src/services/documents/DocumentExtractService";
import * as XLSX from "xlsx";

const localResolver: DnsResolver = async (): Promise<LookupAddress[]> => [
  { address: "127.0.0.1", family: 4 },
];

function minimalPdfBuffer(): Buffer {
  return Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>
endobj
3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>
endobj
4 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>
endobj
5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj
6 0 obj
<< /Length 44 >>
stream
BT /F1 18 Tf 40 80 Td (First page) Tj ET
endstream
endobj
7 0 obj
<< /Length 45 >>
stream
BT /F1 18 Tf 40 80 Td (Second page) Tj ET
endstream
endobj
trailer
<< /Root 1 0 R >>
%%EOF`);
}

describe("DocumentExtract", () => {
  it("detects PDF by magic bytes before misleading headers", () => {
    expect(
      detectFormat({
        buffer: Buffer.from("%PDF-1.4"),
        mimeType: "text/html",
        finalUrl: "https://example.com/file",
        sizeBytes: 8,
      }),
    ).toBe("pdf");
  });

  it("detects Office ZIP formats before headers", () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Name: "Ada" }]), "Sheet1");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

    expect(
      detectFormat({
        buffer,
        mimeType: "application/octet-stream",
        finalUrl: "https://example.com/download",
        sizeBytes: buffer.length,
      }),
    ).toBe("xlsx");
  });

  it("refuses obvious SSRF hosts and DNS resolutions", async () => {
    expect(isBlockedHost("127.0.0.1")).toBe(true);
    expect(isBlockedHost("169.254.169.254")).toBe(true);
    expect(isBlockedHost("::1")).toBe(true);

    await expect(resolveAndCheck(new URL("http://127.0.0.1"))).rejects.toThrow(/Blocked document host/);
    await expect(
      resolveAndCheck(new URL("http://public.example"), false, async () => [
        { address: "169.254.169.254", family: 4 },
      ]),
    ).rejects.toThrow(/blocked address/);
  });

  it("extracts PDF text and page count", async () => {
    const buffer = minimalPdfBuffer();
    const result = await new DocumentExtractService().extract({
      buffer,
      format: "pdf",
      sourceUrl: "https://example.com/two-page.pdf",
      sizeBytes: buffer.length,
      mimeType: "application/pdf",
    });

    expect(result.text).toEqual(expect.stringContaining("First page"));
    expect(result.text).toEqual(expect.stringContaining("Second page"));
    expect(result.metadata).toMatchObject({ pageCount: 2 });
  });

  it("extracts DOCX text", async () => {
    const buffer = Buffer.from(
      "UEsDBBQAAAAIAElz9FwXmADX6wAAALIBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH1QyU4DMQy98xWRr2gmAweEUKc9sByBQ/kAK/HMRM2mOC3t3+NpoQdUONpvs99itQ9e7aiwS7GHm7YDRdEk6+LYw8f6pbkHxRWjRZ8i9XAghtXyarE+ZGIl4sg9TLXmB63ZTBSQ25QpCjKkErDKWEad0WxwJH3bdXfapFgp1qbOHiBmTzTg1lf1vJf96ZJCnkE9nphzWA+Ys3cGq+B6F+2vmOY7ohXlkcOTy3wtBNCXI2bo74Qf4ZuUU5wl9Y6lvmIQmv5MxWqbzDaItP3f58KlaRicobN+dsslGWKW1oNvz0hAF88f6GPlyy9QSwMEFAAAAAgASXP0XD+t/vqvAAAALAEAAAsAAABfcmVscy8ucmVsc43POw7CMAwA0J1TRN5pWgaEUEMXhNQVlQNEiZtWNB/F4dPbk4EBKgZG/57tunnaid0x0uidgKoogaFTXo/OCLh0p/UOGCXptJy8QwEzEjSHVX3GSaY8Q8MYiGXEkYAhpbDnnNSAVlLhA7pc6X20MuUwGh6kukqDfFOWWx4/DVigrNUCYqsrYN0c8B/c9/2o8OjVzaJLP3YsOrIso8Ek4OGj5vqdLjILPJ/Dv548vABQSwMEFAAAAAgASXP0XAyYwk6kAAAA1AAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOvQ7CMAyEd54iyk5TGBCq+jOAEBsLSKwhMW2lxI6SQOnbk5SB5TudTnd23X2sYW/wYSRs+KYoOQNUpEfsG367ntZ7zkKUqKUhhIbPEHjXruqp0qReFjCytIChmho+xOgqIYIawMpQkANM2ZO8lTFZ34uJvHaeFISQDlgjtmW5E1aOyNs0+SA9Z3UZPiO2ZzCG2PFyuNci+0y/0C38dcT/n/YLUEsBAhQDFAAAAAgASXP0XBeYANfrAAAAsgEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABJc/RcP63++q8AAAAsAQAACwAAAAAAAAAAAAAAgAEcAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACABJc/RcDJjCTqQAAADUAAAAEQAAAAAAAAAAAAAAgAH0AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAAxwIAAAAA",
      "base64",
    );

    expect(detectFormat({ buffer, finalUrl: "https://example.com/file", sizeBytes: buffer.length })).toBe("docx");

    const result = await new DocumentExtractService().extract({
      buffer,
      format: "docx",
      sourceUrl: "https://example.com/file.docx",
      sizeBytes: buffer.length,
    });

    expect(result.text).toEqual(expect.stringContaining("Hello DOCX"));
  });

  it("extracts HTML text and title", async () => {
    const result = await new DocumentExtractService().extract({
      buffer: Buffer.from("<html><head><title>Hello</title></head><body><h1>Document</h1><p>Text</p></body></html>"),
      format: "html",
      sourceUrl: "https://example.com",
      sizeBytes: 82,
      mimeType: "text/html",
    });

    expect(result.title).toBe("Hello");
    expect(String(result.text)).toContain("DOCUMENT");
  });

  it("extracts all XLSX sheets using header-row objects", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Name: "Ada", Score: 1 }]), "First");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ Name: "Grace", Score: 2 }]), "Second");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

    const result = await new DocumentExtractService().extract({
      buffer,
      format: "xlsx",
      sourceUrl: "https://example.com/sheet.xlsx",
      sizeBytes: buffer.length,
    });

    expect(result.sheets).toEqual([
      { name: "First", rows: [{ Name: "Ada", Score: 1 }] },
      { name: "Second", rows: [{ Name: "Grace", Score: 2 }] },
    ]);
  });

  it("extracts CSV rows and columns", async () => {
    const result = await new DocumentExtractService().extract({
      buffer: Buffer.from("Name,Score\nAda,1\nGrace,2\n"),
      format: "csv",
      sourceUrl: "https://example.com/scores.csv",
      sizeBytes: 25,
    });

    expect(result).toMatchObject({
      columns: ["Name", "Score"],
      rows: [
        { Name: "Ada", Score: "1" },
        { Name: "Grace", Score: "2" },
      ],
    });
  });

  it("aborts downloads that exceed the size cap", async () => {
    const server = http.createServer((_, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(Buffer.alloc(1024 * 1024 + 1));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    try {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      await expect(
        new DocumentDownloadService(localResolver).fetch(`http://localhost:${port}/large.txt`, {
          timeoutMs: 5000,
          maxBytes: 1024 * 1024,
          allowPrivateHosts: true,
        }),
      ).rejects.toThrow(/maximum size/);
    } finally {
      server.close();
    }
  });
});
