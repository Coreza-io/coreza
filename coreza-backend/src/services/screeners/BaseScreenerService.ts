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

import { IScreenerService, ScreenerInput, ScreenerResult } from './types';
import CredentialManager from '../../utils/credentialManager';

export abstract class BaseScreenerService implements IScreenerService {
  abstract readonly screenerKey: string;
  
  /** Map from operation -> handler(input) */
  protected abstract handlers: Record<
    string, 
    (input: ScreenerInput) => Promise<any>
  >;

  async execute(input: ScreenerInput): Promise<ScreenerResult> {
    const handler = this.handlers[input.operation];
    if (!handler) {
      return {
        success: false,
        error: `Unsupported operation: ${input.operation} for screener: ${this.screenerKey}`
      };
    }

    try {
      const data = await handler.call(this, input);
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  protected async getCredentials(userId: string, credentialId: string): Promise<any> {
    return CredentialManager.getCredentials(userId, this.screenerKey, credentialId);
  }
}
