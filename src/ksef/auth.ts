/**
 * KSeF Authentication
 * Obsługa autentykacji oraz sesji tokenów
 */

import { KsefClient } from './client.js';
import { ksefLogger } from '../logger.js';
import { KsefAuthError, KsefValidationError } from '../errors.js';
import { maskNip, maskToken } from '../utils/sanitize.js';

export interface KsefAuthSession {
  referenceNumber: string;
}

/**
 * KSeF Authentication manager
 * Handles authentication, token refresh, and session management
 */
export class KsefAuth {
  private sessionInfo: KsefAuthSession | null = null;

  constructor(private client: KsefClient) {}

  /**
   * Authenticate with NIP and token
   * Establishes a session valid for 30 minutes
   */
  async authenticate(nip: string, token: string): Promise<KsefAuthSession> {
    ksefLogger.info('🔐 Autentykacja KSeF', { nip: maskNip(nip), token: maskToken(token) });

    try {
      this.sessionInfo = await this.client.authenticate(nip, token);
      ksefLogger.info('🔐 Autentykacja OK', { referenceNumber: this.sessionInfo.referenceNumber });
      return this.sessionInfo;
    } catch (error) {
      ksefLogger.error('❌ Błąd autentykacji', { error: error instanceof Error ? error.message : String(error) });
      throw new KsefAuthError(
        error instanceof Error ? error.message : String(error),
        'AUTHENTICATION_FAILED'
      );
    }
  }

  /**
   * Logout and terminate session
   */
  async logout(): Promise<void> {
    if (!this.sessionInfo) {
      ksefLogger.warn('⚠️ Brak aktywnej sesji do wylogowania');
      return;
    }

    ksefLogger.info('🔒 Wylogowanie z sesji', { referenceNumber: this.sessionInfo.referenceNumber });

    try {
      await this.client.terminateSession();
      this.clearSessionInfo();
      ksefLogger.info('🔒 Wylogowano');
    } catch (error) {
      ksefLogger.error('❌ Wylogowanie nieudane', { error: error instanceof Error ? error.message : String(error) });
      this.clearSessionInfo(); // Clear local session even if API call failed
      throw new KsefAuthError(
        error instanceof Error ? error.message : String(error),
        'LOGOUT_FAILED'
      );
    }
  }

  /**
   * Check if session is still valid
   */
  isSessionValid(): boolean {
    return this.client.isSessionValid();
  }

  /**
   * Get current session info
   */
  getSessionInfo(): KsefAuthSession | null {
    if (!this.isSessionValid()) {
      return null;
    }

    return this.sessionInfo;
  }

  /**
   * Clear session information
   */
  private clearSessionInfo(): void {
    this.sessionInfo = null;
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    this.clearSessionInfo();
  }
}

/**
 * Create auth instance with client
 */
export const createAuth = (client: KsefClient): KsefAuth => {
  return new KsefAuth(client);
};
