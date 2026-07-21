import { INodeExecutor, NodeInput, NodeResult, WorkflowNode } from "../types";
import { createErrorOutput, createSuccessOutput, toNodeResult } from "../../utils/normalizeOutput";
import { DocumentDownloadService } from "../../services/documents/DocumentDownloadService";
import { DocumentExtractService } from "../../services/documents/DocumentExtractService";
import { detectFormat } from "../../services/documents/detectFormat";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;

export class DocumentExecutor implements INodeExecutor {
  readonly category = "Document";

  constructor(
    private readonly downloader = new DocumentDownloadService(),
    private readonly extractor = new DocumentExtractService(),
  ) {}

  async execute(node: WorkflowNode, input: NodeInput, context?: any): Promise<NodeResult> {
    const startTime = Date.now();

    try {
      const resolvedParams = context?.resolveNodeParameters
        ? context.resolveNodeParameters(node, input)
        : { ...node.values, ...input };
      const url = String(resolvedParams.url ?? "").trim();

      if (!url) {
        return toNodeResult(createErrorOutput("Document URL is required", { nodeId: node.id, nodeName: node.name, category: this.category, startTime }));
      }

      const download = await this.downloader.fetch(url, {
        timeoutMs: DEFAULT_TIMEOUT_MS,
        maxBytes: DEFAULT_MAX_BYTES,
        maxRedirects: DEFAULT_MAX_REDIRECTS,
      });
      const format = detectFormat(download);
      const extracted = await this.extractor.extract({
        buffer: download.buffer,
        format,
        mimeType: download.mimeType,
        fileName: download.fileName,
        sourceUrl: download.finalUrl,
        sizeBytes: download.sizeBytes,
      });

      return toNodeResult(createSuccessOutput(extracted, { nodeId: node.id, nodeName: node.name, category: this.category, startTime }));
    } catch (error) {
      return toNodeResult(createErrorOutput(error instanceof Error ? error : String(error), { nodeId: node.id, nodeName: node.name, category: this.category, startTime }));
    }
  }
}
