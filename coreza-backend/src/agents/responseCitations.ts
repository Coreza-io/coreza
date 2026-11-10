export interface ResponseCitation {
  url: string;
  title: string;
  startIndex: number | null;
  endIndex: number | null;
}

/** Keep block offsets local. For non-BMP text, do not guess an unverified provider offset unit. */
export function extractResponseCitations(message: any, text: string) {
  const citations: ResponseCitation[] = [];
  const seen = new Set<string>();
  let offset = 0;
  const blocks = Array.isArray(message?.content) ? message.content : [];
  for (const block of blocks) {
    if (!['text', 'output_text'].includes(block?.type) || typeof block.text !== 'string') continue;
    const pointOffsets = [0];
    for (const character of block.text as string) pointOffsets.push(pointOffsets[pointOffsets.length - 1] + character.length);
    for (const annotation of (Array.isArray(block.annotations) ? block.annotations : []).slice(0, 200)) {
      if (citations.length >= 200) break;
      if (!(annotation?.type === 'citation' && annotation.source === 'url_citation') && annotation?.type !== 'url_citation') continue;
      let url: URL;
      try { url = new URL(annotation.url); } catch { continue; }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) continue;
      const start = annotation.startIndex ?? annotation.start_index;
      const end = annotation.endIndex ?? annotation.end_index;
      const valid = Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start;
      const pointStart = valid ? pointOffsets[start] ?? null : null;
      const pointEnd = valid ? pointOffsets[end] ?? null : null;
      // The adapter preserves provider indices but does not declare code points vs UTF-16.
      // Only attach inline attribution when both interpretations agree; keep a source link otherwise.
      const unambiguous = valid && end <= block.text.length && pointStart === start && pointEnd === end;
      const startIndex = unambiguous ? offset + start : null;
      const endIndex = unambiguous ? offset + end : null;
      const key = JSON.stringify([url.href, startIndex, endIndex]);
      if (seen.has(key)) continue;
      seen.add(key);
      citations.push({ url: url.href, title: typeof annotation.title === 'string' ? annotation.title.slice(0, 256) : url.hostname,
        startIndex, endIndex });
    }
    offset += block.text.length;
  }
  // Never apply offsets to text rewritten or joined differently by another extraction path.
  if (blocks.filter((b: any) => ['text', 'output_text'].includes(b?.type) && typeof b.text === 'string').map((b: any) => b.text).join('') !== text) {
    for (const citation of citations) { citation.startIndex = null; citation.endIndex = null; }
  }
  return { text, citations };
}

export function citationMemory(response: ReturnType<typeof extractResponseCitations>): string {
  // A source list preserves even citations with malformed ranges, without inventing attribution.
  const sources = [...new Set(response.citations.map(c => c.url))];
  if (!sources.length) return response.text;
  // Angle-delimited Markdown destinations preserve IPv6 hosts and parentheses in valid URLs.
  const link = (url: string) => `[${sources.indexOf(url) + 1}](<${url}>)`;
  let cursor = 0, text = '';
  let lastStart: number | null = null, lastEnd: number | null = null;
  const used = new Set<string>();
  for (const citation of [...response.citations].sort((a, b) => (a.startIndex ?? Infinity) - (b.startIndex ?? Infinity) || (a.endIndex ?? Infinity) - (b.endIndex ?? Infinity) || a.url.localeCompare(b.url))) {
    const sameRange = citation.startIndex === lastStart && citation.endIndex === lastEnd;
    if (citation.startIndex == null || citation.endIndex == null || (citation.startIndex < cursor && !sameRange)) continue;
    const key = JSON.stringify([citation.url, citation.startIndex, citation.endIndex]);
    if (used.has(key)) continue;
    used.add(key);
    text += (sameRange ? '' : response.text.slice(cursor, citation.endIndex)) + link(citation.url);
    lastStart = citation.startIndex; lastEnd = citation.endIndex;
    cursor = citation.endIndex;
  }
  text += response.text.slice(cursor);
  return `${text}\n\nSources from this response (reverify time-sensitive facts):\n${sources.map(link).join('\n')}`;
}

export function nativeSearchCalls(messages: any[]) {
  const calls = new Map<string, { id: string; status: string }>();
  for (const message of messages) {
    for (const item of (Array.isArray(message?.additional_kwargs?.tool_outputs) ? message.additional_kwargs.tool_outputs : [])) {
      if (item?.type !== 'web_search_call' || typeof item.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(item.id)) continue;
      const status = ['completed', 'failed', 'in_progress', 'searching'].includes(item.status) ? item.status : 'unknown';
      if (calls.has(item.id) || calls.size < 100) calls.set(item.id, { id: item.id, status });
    }
  }
  return [...calls.values()];
}
