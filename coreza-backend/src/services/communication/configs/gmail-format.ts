/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { gmail_v1 } from "googleapis";

export interface FormattedGmailMessage {
  id?: string | null;
  threadId?: string | null;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet?: string | null;
  internalDate?: string | null;
  content: {
    text?: string;
    html?: string;
  };
  labels?: string[] | null;
  raw: gmail_v1.Schema$Message;
}

const decodeBase64Url = (value: string): string =>
  Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();

const extractContent = (
  part?: gmail_v1.Schema$MessagePart,
): { text?: string; html?: string } => {
  if (!part) return {};

  const content: { text?: string; html?: string } = {};

  if (part.body?.data) {
    const decodedContent = decodeBase64Url(part.body.data);
    if (part.mimeType === "text/plain") {
      content.text = decodedContent;
    } else if (part.mimeType === "text/html") {
      content.html = decodedContent;
    }
  }

  for (const subPart of part.parts ?? []) {
    const nested = extractContent(subPart);
    content.text = content.text ?? nested.text;
    content.html = content.html ?? nested.html;
  }

  return content;
};

export function formatGmailMessage(
  msgDetail: gmail_v1.Schema$Message,
): FormattedGmailMessage {
  const headers: gmail_v1.Schema$MessagePartHeader[] =
    msgDetail.payload?.headers ?? [];
  const getHeader = (name: string) =>
    headers.find((header) => header.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? "";
  const content = extractContent(msgDetail.payload ?? undefined);

  return {
    id: msgDetail.id,
    threadId: msgDetail.threadId,
    from: getHeader("From"),
    to: getHeader("To"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    snippet: msgDetail.snippet,
    internalDate: msgDetail.internalDate,
    content: {
      text: content.text,
      html: content.html,
    },
    labels: msgDetail.labelIds,
    raw: msgDetail,
  };
}
