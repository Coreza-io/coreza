/*
 * Copyright (C) 2024 Coreza
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { NextFunction, Request, Response } from 'express';
import supabase from '../config/supabase';
import { FEATURE_GATES, UPGRADE_URL } from '../config/featureGates';
import { Subscription, SubscriptionTier } from '../types/subscription';

const ACTIVE_STATUSES = ['active', 'trial'];

function getUserId(req: Request): string | undefined {
  return (req as any).user?.id || req.body?.user_id || req.query?.user_id || (req.headers['x-user-id'] as string);
}

async function fetchSubscription(userId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from('subscriptions' as any)
    .select('*')
    .eq('user_id', userId)
    .in('status', ACTIVE_STATUSES)
    .order('current_period_end', { ascending: false })
    .limit(1);

  if (error) {
    console.error('[licenseCheck] Failed to load subscription', error);
    return null;
  }

  return data && data.length > 0 ? (data[0] as Subscription) : null;
}

function isTierAuthorized(subscription: Subscription | null, allowedTiers: SubscriptionTier[]): boolean {
  if (!subscription) return false;
  return ACTIVE_STATUSES.includes(subscription.status) && allowedTiers.includes(subscription.tier);
}

function findFeatureTiers(feature: string, fallback: SubscriptionTier[]): SubscriptionTier[] {
  const gate = FEATURE_GATES.find((entry) => entry.feature === feature);
  return gate?.required_tier || fallback;
}

function buildForbiddenResponse(res: Response, feature: string, allowedTiers: SubscriptionTier[]) {
  return res.status(403).json({
    error: `${feature} requires one of the following plans: ${allowedTiers.join(', ')}`,
    upgrade_url: UPGRADE_URL,
  });
}

async function validateLicense(req: Request, res: Response, next: NextFunction, feature: string, tiers: SubscriptionTier[]) {
  const userId = getUserId(req);
  if (!userId) {
    return res.status(400).json({ error: 'user_id is required for license validation' });
  }

  const allowedTiers = findFeatureTiers(feature, tiers);
  const subscription = await fetchSubscription(userId);

  if (!isTierAuthorized(subscription, allowedTiers)) {
    return buildForbiddenResponse(res, feature, allowedTiers);
  }

  (req as any).subscription = subscription;
  return next();
}

export function requireTrader(feature: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    validateLicense(req, res, next, feature, ['trader', 'professional', 'enterprise']);
}

export function requirePro(feature: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    validateLicense(req, res, next, feature, ['professional', 'enterprise']);
}

export function requireProfessional(feature: string) {
  return requirePro(feature);
}

export function requireEnterprise(feature: string) {
  return (req: Request, res: Response, next: NextFunction) =>
    validateLicense(req, res, next, feature, ['enterprise']);
}
