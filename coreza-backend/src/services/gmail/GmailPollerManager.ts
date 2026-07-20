/**
 * Coreza - Open-source trading workflow automation platform
 * Copyright (C) 2026 Coreza-io
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License v3.0.
 *
 * See the LICENSE file for details.
 */

import { google, gmail_v1 } from "googleapis";
import { getRedisCache } from "../../config/redis";
import { createLogger } from "../../utils/logger";
import CredentialManager from "../../utils/credentialManager";
import { refreshOAuthTokenIfNeeded } from "../../utils/oauthTokenManager";
import {
  getReconnectRequiredCode,
  isBrokerAuthError,
} from "../../utils/brokerAuthError";
import { formatGmailMessage } from "../communication/configs/gmail-format";

export interface GmailTriggerFilters {
  fromEmail?: string;
  toEmail?: string;
  subjectContains?: string;
  bodyContains?: string;
  labelIds?: string[];
  unreadOnly?: boolean;
  hasAttachment?: boolean;
  pollIntervalSeconds?: number;
  markAsRead?: boolean;
}

interface GmailPollerRegistration {
  creds: Record<string, unknown>;
  filters?: Record<string, unknown>;
  workflowId: string;
  nodeId: string;
  userId?: string;
  credentialId?: string;
}

interface ActivePoller
  extends Omit<
    GmailPollerRegistration,
    "credentialId" | "creds" | "filters" | "userId"
  > {
  userId: string;
  credentialId: string;
  filters: GmailTriggerFilters;
  timer: NodeJS.Timeout;
  isPolling: boolean;
  backoffMs: number;
}

const logger = createLogger("GmailPollerManager");
const MIN_POLL_INTERVAL_SECONDS = 30;
const DEFAULT_POLL_INTERVAL_SECONDS = 60;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

const quote = (value: string) => `"${value.replace(/"/g, '\\"')}"`;

class GmailPollerManager {
  private readonly pollers = new Map<string, ActivePoller>();

  async start(
    registration: GmailPollerRegistration,
  ): Promise<{ success: boolean; description?: string }> {
    const { workflowId, nodeId, userId, credentialId } = registration;
    if (!workflowId || !nodeId || !userId || !credentialId) {
      return {
        success: false,
        description:
          "workflowId, nodeId, userId, and credentialId are required for Gmail polling",
      };
    }

    const key = this.key(workflowId, nodeId);
    await this.stopByKey(key);
    await this.seedWatermark(workflowId, nodeId);

    const filters = this.normalizeFilters(registration.filters);
    const intervalSeconds = Math.max(
      filters.pollIntervalSeconds || DEFAULT_POLL_INTERVAL_SECONDS,
      MIN_POLL_INTERVAL_SECONDS,
    );

    const activePoller: ActivePoller = {
      workflowId,
      nodeId,
      userId,
      credentialId,
      filters,
      timer: setInterval(() => {
        void this.poll(key);
      }, intervalSeconds * 1000),
      isPolling: false,
      backoffMs: 0,
    };

    this.pollers.set(key, activePoller);
    void this.poll(key);

    return { success: true, description: "Gmail poller started" };
  }

  async stop(workflowId?: string, nodeId?: string, credentialId?: string) {
    if (workflowId && nodeId) {
      return this.stopByKey(this.key(workflowId, nodeId));
    }

    let stopped = false;
    for (const [key, poller] of this.pollers.entries()) {
      if (!credentialId || poller.credentialId === credentialId) {
        clearInterval(poller.timer);
        this.pollers.delete(key);
        stopped = true;
      }
    }

    return stopped;
  }

  status() {
    return Array.from(this.pollers.entries()).map(([key, poller]) => ({
      key,
      workflowId: poller.workflowId,
      nodeId: poller.nodeId,
      credentialId: poller.credentialId,
      isPolling: poller.isPolling,
      backoffMs: poller.backoffMs,
    }));
  }

  private async stopByKey(key: string) {
    const existing = this.pollers.get(key);
    if (!existing) return false;
    clearInterval(existing.timer);
    this.pollers.delete(key);
    return true;
  }

  private async poll(key: string): Promise<void> {
    const poller = this.pollers.get(key);
    if (!poller || poller.isPolling) return;

    if (poller.backoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, poller.backoffMs));
    }

    poller.isPolling = true;
    try {
      const freshCredentials = await this.getFreshCredentials(poller);
      const gmail = this.createClient(freshCredentials);
      const watermark = await this.getWatermark(
        poller.workflowId,
        poller.nodeId,
      );
      const listResult = await gmail.users.messages.list({
        userId: "me",
        q: this.buildQuery(poller.filters, watermark),
        labelIds: poller.filters.labelIds,
        maxResults: 25,
      });

      let newestWatermark = watermark;
      const messages = listResult.data.messages ?? [];
      for (const message of messages.reverse()) {
        if (!message.id) continue;
        const detail = await gmail.users.messages.get({
          userId: "me",
          id: message.id,
          format: "full",
        });
        const internalDate = Number(detail.data.internalDate ?? 0);
        if (internalDate <= watermark) continue;

        const formattedMessage = formatGmailMessage(detail.data);
        const { webhookService } = await import("../WebhookService");
        await webhookService.dispatchInternal(
          poller.workflowId,
          poller.nodeId,
          "gmail",
          formattedMessage,
          poller.userId,
        );

        if (poller.filters.markAsRead) {
          await this.markAsRead(gmail, message.id);
        }
        newestWatermark = Math.max(newestWatermark, internalDate);
      }

      if (newestWatermark > watermark) {
        await this.setWatermark(
          poller.workflowId,
          poller.nodeId,
          newestWatermark,
        );
      }
      poller.backoffMs = 0;
    } catch (error) {
      if (this.isReconnectRequiredError(error)) {
        await this.stopByKey(key);
        const { webhookService } = await import("../WebhookService");
        await webhookService.dispatchInternalError(
          poller.workflowId,
          poller.nodeId,
          "gmail",
          {
            code: "OAUTH_RECONNECT_REQUIRED",
            message:
              "Gmail refresh token expired — please reconnect the Gmail credential.",
            recoverable: false,
          },
          poller.userId,
        );
        logger.warn(
          {
            err: error,
            workflowId: poller.workflowId,
            nodeId: poller.nodeId,
            credentialId: poller.credentialId,
          },
          "Gmail refresh token invalid — user must reconnect the credential",
        );
        return;
      }

      if (this.isInsufficientScopeError(error)) {
        await this.stopByKey(key);
        const missingScope = poller.filters.markAsRead
          ? "gmail.modify"
          : "gmail.readonly";
        const { webhookService } = await import("../WebhookService");
        await webhookService.dispatchInternalError(
          poller.workflowId,
          poller.nodeId,
          "gmail",
          {
            code: "OAUTH_INSUFFICIENT_SCOPE",
            message: `Gmail credential is missing required scope (${missingScope}). Please reconnect and grant the scope.`,
            recoverable: false,
          },
          poller.userId,
        );
        logger.warn(
          {
            err: error,
            workflowId: poller.workflowId,
            nodeId: poller.nodeId,
            credentialId: poller.credentialId,
            missingScope,
          },
          "Gmail credential is missing required OAuth scope — user must reconnect the credential",
        );
        return;
      }

      poller.backoffMs = this.nextBackoff(poller.backoffMs);
      logger.error(
        { err: error, workflowId: poller.workflowId, nodeId: poller.nodeId },
        "Gmail poll failed",
      );
    } finally {
      poller.isPolling = false;
    }
  }

  private async getFreshCredentials(
    poller: ActivePoller,
  ): Promise<Record<string, unknown>> {
    const { credentials: stored } = await CredentialManager.getCredentials(
      poller.userId,
      "gmail",
      poller.credentialId,
      { useCache: false },
    );

    if (!stored) {
      throw new Error("Gmail credentials not found");
    }

    const mergedCredentials = {
      ...stored.client_json,
      ...stored.token_json,
    };

    return refreshOAuthTokenIfNeeded(
      "gmail",
      mergedCredentials,
      poller.userId,
      poller.credentialId,
    );
  }

  private normalizeFilters(
    filters?: Record<string, unknown>,
  ): GmailTriggerFilters {
    const stringValue = (value: unknown) =>
      typeof value === "string" && value.trim() ? value.trim() : undefined;
    const booleanValue = (value: unknown, defaultValue = false) =>
      typeof value === "boolean" ? value : defaultValue;
    const labelIds = Array.isArray(filters?.labelIds)
      ? filters.labelIds.filter(
          (labelId): labelId is string =>
            typeof labelId === "string" && labelId.trim().length > 0,
        )
      : undefined;
    const rawPollInterval = Number(filters?.pollIntervalSeconds);

    return {
      fromEmail: stringValue(filters?.fromEmail),
      toEmail: stringValue(filters?.toEmail),
      subjectContains: stringValue(filters?.subjectContains),
      bodyContains: stringValue(filters?.bodyContains),
      labelIds,
      unreadOnly: booleanValue(filters?.unreadOnly, true),
      hasAttachment: booleanValue(filters?.hasAttachment),
      pollIntervalSeconds: Number.isFinite(rawPollInterval)
        ? rawPollInterval
        : undefined,
      markAsRead: booleanValue(filters?.markAsRead),
    };
  }

  private createClient(creds: Record<string, unknown>): gmail_v1.Gmail {
    const auth = new google.auth.OAuth2(
      String(creds.client_id ?? ""),
      String(creds.client_secret ?? ""),
      String(creds.redirect_uri ?? ""),
    );
    auth.setCredentials({
      refresh_token:
        typeof creds.refresh_token === "string"
          ? creds.refresh_token
          : undefined,
      access_token:
        typeof creds.access_token === "string" ? creds.access_token : undefined,
    });
    return google.gmail({ version: "v1", auth });
  }

  private buildQuery(filters: GmailTriggerFilters, watermark: number) {
    const terms: string[] = [`after:${Math.floor(watermark / 1000)}`];
    if (filters.unreadOnly) terms.push("is:unread");
    if (filters.fromEmail) terms.push(`from:${quote(filters.fromEmail)}`);
    if (filters.toEmail) terms.push(`to:${quote(filters.toEmail)}`);
    if (filters.subjectContains) {
      terms.push(`subject:${quote(filters.subjectContains)}`);
    }
    if (filters.bodyContains) terms.push(quote(filters.bodyContains));
    if (filters.hasAttachment) terms.push("has:attachment");
    return terms.join(" ");
  }

  private async markAsRead(gmail: gmail_v1.Gmail, messageId: string) {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
  }

  private async seedWatermark(workflowId: string, nodeId: string) {
    const redis = getRedisCache();
    await redis.setnx(
      this.watermarkKey(workflowId, nodeId),
      String(Date.now()),
    );
  }

  private async getWatermark(workflowId: string, nodeId: string) {
    const value = await getRedisCache().get(
      this.watermarkKey(workflowId, nodeId),
    );
    return Number(value) || Date.now();
  }

  private async setWatermark(
    workflowId: string,
    nodeId: string,
    watermark: number,
  ) {
    await getRedisCache().set(
      this.watermarkKey(workflowId, nodeId),
      String(watermark),
    );
  }

  private nextBackoff(current: number) {
    return current === 0 ? 30_000 : Math.min(current * 2, MAX_BACKOFF_MS);
  }

  private isReconnectRequiredError(error: unknown) {
    if (
      isBrokerAuthError(error) &&
      error.code === getReconnectRequiredCode()
    ) {
      return true;
    }

    return this.errorText(error).includes("invalid_grant");
  }

  private isInsufficientScopeError(error: unknown) {
    return (
      this.errorStatus(error) === 403 &&
      this.errorText(error).includes("insufficient authentication scopes")
    );
  }

  private errorStatus(error: unknown) {
    return (
      (error as { code?: number; response?: { status?: number } })?.code ??
      (error as { response?: { status?: number } })?.response?.status
    );
  }

  private errorText(error: unknown) {
    if (typeof error !== "object" || error === null) return String(error);

    const maybeError = error as {
      message?: string;
      response?: { data?: unknown };
    };
    const responseData = maybeError.response?.data;
    const responseText =
      typeof responseData === "string"
        ? responseData
        : responseData
          ? JSON.stringify(responseData)
          : "";

    return [maybeError.message, responseText]
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase();
  }

  private key(workflowId: string, nodeId: string) {
    return `${workflowId}:${nodeId}`;
  }

  private watermarkKey(workflowId: string, nodeId: string) {
    return `gmail_trigger:${workflowId}:${nodeId}:watermark`;
  }
}

export const gmailPollerManager = new GmailPollerManager();
