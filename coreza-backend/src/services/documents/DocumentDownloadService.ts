import axios, { AxiosResponse } from "axios";
import { LookupAddress } from "dns";
import { lookup as dnsLookup } from "dns/promises";
import http from "http";
import https from "https";
import { isIP, LookupFunction } from "net";
import { Readable } from "stream";
import { filenameFromDisposition } from "./detectFormat";
import { DownloadedDocument } from "./types";

export interface DownloadOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects?: number;
  allowPrivateHosts?: boolean;
}

export type DnsResolver = (hostname: string, family?: number) => Promise<LookupAddress[]>;

const METADATA_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.azure.internal",
  "169.254.169.254",
]);

const DEFAULT_RESOLVER: DnsResolver = (hostname, family) =>
  dnsLookup(hostname, { all: true, family, verbatim: true });

function ipv4ToNumber(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

function isPrivateIpv4(ip: string): boolean {
  const value = ipv4ToNumber(ip);
  return (
    (value & 0xff000000) === 0x0a000000 ||
    (value & 0xff000000) === 0x7f000000 ||
    (value & 0xfff00000) === 0xac100000 ||
    (value & 0xffff0000) === 0xc0a80000 ||
    (value & 0xffff0000) === 0xa9fe0000 ||
    value === 0
  );
}

function isBlockedIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::" || normalized === "::1") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fc") || normalized.startsWith("fd")) return true;

  const mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  return mapped ? isPrivateIpv4(mapped[1]) : false;
}

export function isBlockedHost(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (METADATA_HOSTS.has(normalized)) return true;

  const ipVersion = isIP(normalized);
  if (ipVersion === 4) return isPrivateIpv4(normalized);
  if (ipVersion === 6) return isBlockedIpv6(normalized);

  return false;
}

export async function resolveAndCheck(
  url: URL,
  allowPrivateHosts = false,
  resolver: DnsResolver = DEFAULT_RESOLVER,
): Promise<void> {
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported document URL protocol: ${url.protocol}`);
  }

  if (allowPrivateHosts) return;
  if (isBlockedHost(url.hostname)) {
    throw new Error(`Blocked document host: ${url.hostname}`);
  }

  const records = await resolver(url.hostname);
  if (records.some((record) => isBlockedHost(record.address))) {
    throw new Error(`Document URL resolves to a blocked address: ${url.hostname}`);
  }
}

function createSafeAgent(
  protocol: "http:" | "https:",
  allowPrivateHosts: boolean,
  resolver: DnsResolver,
): http.Agent | https.Agent {
  const safeLookup: LookupFunction = (hostname, options, callback) => {
    void (async () => {
      try {
        const family = typeof options.family === "number" ? options.family : undefined;
        const records = await resolver(hostname, family);

        if (!allowPrivateHosts && records.some((record) => isBlockedHost(record.address))) {
          callback(
            new Error(`Document URL resolves to a blocked address: ${hostname}`) as NodeJS.ErrnoException,
            "",
            0,
          );
          return;
        }

        if (options.all) {
          callback(null, records);
          return;
        }

        callback(null, records[0].address, records[0].family);
      } catch (error) {
        callback(error as NodeJS.ErrnoException, "", 0);
      }
    })();
  };

  const agentOptions: http.AgentOptions = { lookup: safeLookup };
  return protocol === "https:" ? new https.Agent(agentOptions) : new http.Agent(agentOptions);
}

export class DocumentDownloadService {
  constructor(private readonly resolver: DnsResolver = DEFAULT_RESOLVER) {}

  async fetch(url: string, options: DownloadOptions): Promise<DownloadedDocument> {
    const maxRedirects = options.maxRedirects ?? 5;
    const allowPrivateHosts = options.allowPrivateHosts === true;
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), options.timeoutMs);
    let currentUrl = new URL(url);

    try {
      for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
        await resolveAndCheck(currentUrl, allowPrivateHosts, this.resolver);

        const response = await axios.get<Readable>(currentUrl.toString(), {
          responseType: "stream",
          timeout: options.timeoutMs,
          signal: abortController.signal,
          maxRedirects: 0,
          validateStatus: () => true,
          headers: { "User-Agent": "Coreza-DocumentExtract/1.0" },
          httpAgent: createSafeAgent("http:", allowPrivateHosts, this.resolver),
          httpsAgent: createSafeAgent("https:", allowPrivateHosts, this.resolver),
        });

        if (response.status >= 300 && response.status < 400 && response.headers.location) {
          response.data.destroy();
          const nextUrl = new URL(response.headers.location, currentUrl);
          if (currentUrl.protocol === "https:" && nextUrl.protocol === "http:") {
            throw new Error("Refusing HTTPS to HTTP document redirect");
          }
          currentUrl = nextUrl;
          continue;
        }

        if (response.status < 200 || response.status >= 300) {
          response.data.destroy();
          throw new Error(`Document download failed with status ${response.status}`);
        }

        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > options.maxBytes) {
          response.data.destroy();
          throw new Error(`Document exceeds maximum size of ${options.maxBytes} bytes`);
        }

        return this.readStream(response, currentUrl.toString(), options.maxBytes);
      }

      throw new Error(`Document redirect limit exceeded (${maxRedirects})`);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readStream(
    response: AxiosResponse<Readable>,
    finalUrl: string,
    maxBytes: number,
  ): Promise<DownloadedDocument> {
    const chunks: Buffer[] = [];
    let sizeBytes = 0;

    for await (const chunk of response.data) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      sizeBytes += buffer.length;

      if (sizeBytes > maxBytes) {
        response.data.destroy();
        throw new Error(`Document exceeds maximum size of ${maxBytes} bytes`);
      }

      chunks.push(buffer);
    }

    const contentDisposition = response.headers["content-disposition"] as string | undefined;
    const urlFileName = decodeURIComponent(new URL(finalUrl).pathname.split("/").pop() ?? "");

    return {
      buffer: Buffer.concat(chunks, sizeBytes),
      mimeType: response.headers["content-type"] as string | undefined,
      fileName: filenameFromDisposition(contentDisposition) ?? urlFileName,
      contentDisposition,
      finalUrl,
      sizeBytes,
    };
  }
}
