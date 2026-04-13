/**
 * KSeF Authentication
 * Obsługa autentykacji oraz sesji tokenów
 */

import { KsefClient } from './client.js';
import { logger } from '../logger.js';
import { KsefAuthError, KsefValidationError } from '../errors.js';
import type { SessionInfo } from './types.js';

/**
 * KSeF Authentication manager
 * Handles authentication, token refresh, and session management
 */
export class KsefAuth {
  private sessionInfo: SessionInfo | null = null;
  private refreshTokenTimeout: NodeJS.Timeout | null = null;

  constructor(private client: KsefClient) {}

  /**
   * Authenticate with NIP and token
   * Establishes a session valid for 30 minutes
   */
  async authenticate(nip: string, token: string): Promise<SessionInfo> {
    logger.info(`Authenticating KSeF with NIP: ${nip}`);

    try {
      this.sessionInfo = await this.client.authenticate(nip, token);

      // Schedule automatic token refresh (refresh at 80% of expiry time)
      this.scheduleTokenRefresh();

      logger.info(`Authentication successful. Session valid until: ${this.sessionInfo.sessionToken.expiryDate}`);
      return this.sessionInfo;
    } catch (error) {
      logger.error('Authentication failed', error);
      throw new KsefAuthError(
        error instanceof Error ? error.message : String(error),
        'AUTHENTICATION_FAILED'
      );
    }
  }

  /**
   * Refresh current token
   * Gets a new token using the current session
   */
  async refreshToken(): Promise<SessionInfo> {
    if (!this.sessionInfo) {
      throw new KsefAuthError('No active session to refresh', 'NO_SESSION');
    }

    logger.info(`Refreshing KSeF token for session: ${this.sessionInfo.referenceNumber}`);

    try {
      // Create new client with current session token to authenticate refresh
      // In KSeF v2 API, we need to re-authenticate
      // For now, this is a placeholder - actual implementation depends on API version
      throw new KsefAuthError(
        'Token refresh not yet implemented for v2 API',
        'NOT_IMPLEMENTED'
      );
    } catch (error) {
      logger.error('Token refresh failed', error);
      throw new KsefAuthError(
        error instanceof Error ? error.message : String(error),
        'REFRESH_FAILED'
      );
    }
  }

  /**
   * Logout and terminate session
   */
  async logout(): Promise<void> {
    if (!this.sessionInfo) {
      logger.warn('No active session to logout from');
      return;
    }

    logger.info(`Logging out from KSeF session: ${this.sessionInfo.referenceNumber}`);

    try {
      await this.client.terminateSession();
      this.clearSessionInfo();
      logger.info('Logout successful');
    } catch (error) {
      logger.error('Logout failed', error);
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
    if (!this.sessionInfo) {
      return false;
    }

    return this.client.isSessionValid();
  }

  /**
   * Get current session info
   */
  getSessionInfo(): SessionInfo | null {
    if (!this.isSessionValid()) {
      return null;
    }

    return this.sessionInfo;
  }

  /**
   * Get session token
   */
  getSessionToken(): string {
    if (!this.sessionInfo) {
      throw new KsefValidationError('No active session');
    }

    if (!this.isSessionValid()) {
      throw new KsefValidationError('Session expired');
    }

    return this.sessionInfo.sessionToken.token;
  }

  /**
   * Schedule automatic token refresh before expiry
   */
  private scheduleTokenRefresh(): void {
    if (!this.sessionInfo) {
      return;
    }

    // Clear any existing timeout
    if (this.refreshTokenTimeout) {
      clearTimeout(this.refreshTokenTimeout);
    }

    const expiryTime = new Date(this.sessionInfo.sessionToken.expiryDate).getTime();
    const now = Date.now();
    const timeUntilExpiry = expiryTime - now;

    // Refresh at 80% of expiry time (e.g., for 30 min session, refresh at 24 min)
    const refreshTime = Math.max(timeUntilExpiry * 0.8, 60000); // At least 1 minute

    logger.info(`Scheduling token refresh in ${Math.round(refreshTime / 1000)} seconds`);

    this.refreshTokenTimeout = setTimeout(() => {
      this.refreshToken()
        .then(() => {
          logger.info('Token refreshed successfully');
        })
        .catch((error) => {
          logger.error('Automatic token refresh failed', error);
        });
    }, refreshTime);
  }

  /**
   * Clear session information
   */
  private clearSessionInfo(): void {
    this.sessionInfo = null;

    if (this.refreshTokenTimeout) {
      clearTimeout(this.refreshTokenTimeout);
      this.refreshTokenTimeout = null;
    }
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
