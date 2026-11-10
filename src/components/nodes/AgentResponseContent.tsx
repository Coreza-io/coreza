import React from 'react';

type Citation = { url: string; title?: string; startIndex?: number | null; endIndex?: number | null };

export function isAgentResponse(value: unknown): value is { text: string; citations?: Citation[] } {
  return !!value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string';
}

/** Persisted outputs are untrusted too: validate URLs and ranges again before rendering. */
export function AgentResponseContent({ response }: { response: { text: string; citations?: Citation[] } }) {
  const text = response.text;
  const citations = (Array.isArray(response.citations) ? response.citations : []).slice(0, 200).flatMap(citation => {
    try {
      const url = new URL(citation?.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.href.length > 2048) return [];
      return [{ ...citation, url: url.href, title: typeof citation.title === 'string' ? citation.title.slice(0, 256) : url.hostname }];
    } catch { return []; }
  });
  const sources = [...new Map(citations.map(c => [c.url, c])).values()];
  const content: React.ReactNode[] = [];
  let cursor = 0;
  let lastStart: number | null = null, lastEnd: number | null = null;
  const used = new Set<string>();
  const isTextBoundary = (index: number) => !(index > 0 && index < text.length &&
    text.charCodeAt(index - 1) >= 0xD800 && text.charCodeAt(index - 1) <= 0xDBFF &&
    text.charCodeAt(index) >= 0xDC00 && text.charCodeAt(index) <= 0xDFFF);
  const ranges = citations.filter(c => Number.isInteger(c.startIndex) && Number.isInteger(c.endIndex) &&
    c.startIndex! >= 0 && c.endIndex! >= c.startIndex! && c.endIndex! <= text.length &&
    isTextBoundary(c.startIndex!) && isTextBoundary(c.endIndex!))
    .sort((a, b) => a.startIndex! - b.startIndex! || a.endIndex! - b.endIndex! || a.url.localeCompare(b.url));
  for (const citation of ranges) {
    const key = `${citation.startIndex}:${citation.endIndex}:${citation.url}`;
    const sameRange = citation.startIndex === lastStart && citation.endIndex === lastEnd;
    if ((citation.startIndex! < cursor && !sameRange) || used.has(key)) continue;
    used.add(key);
    if (!sameRange) content.push(text.slice(cursor, citation.endIndex!));
    content.push(<a key={key} href={citation.url} target="_blank" rel="noopener noreferrer" className="text-primary underline mx-1" title={citation.title} aria-label={`Source: ${citation.title}`}>
      [{sources.findIndex(source => source.url === citation.url) + 1}]
    </a>);
    cursor = citation.endIndex!;
    lastStart = citation.startIndex!; lastEnd = citation.endIndex!;
  }
  content.push(text.slice(cursor));
  return <section className="p-3 rounded-md border border-border/30 space-y-3" aria-label="Agent response">
    <div className="text-sm whitespace-pre-wrap break-words">{content}</div>
    {sources.length > 0 && <div className="text-xs space-y-1 border-t pt-2">
      <div className="font-semibold">Sources</div>
      {sources.map((citation, index) => <a key={citation.url} href={citation.url} target="_blank" rel="noopener noreferrer" className="block text-primary underline break-words">[{index + 1}] {citation.title || citation.url}</a>)}
    </div>}
  </section>;
}
