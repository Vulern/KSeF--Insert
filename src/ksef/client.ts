/**
 * KSeF HTTP Client
 * Klient HTTP do komunikacji z API KSeF
 */

import axios, { AxiosInstance } from 'axios';
import { config } from '../config.js';
import { logger } from '../logger.js';

export class KsefClient {
  private httpClient: AxiosInstance;

  constructor() {
    this.httpClient = axios.create({
      baseURL: config.ksef.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // TODO: Add request/response interceptors
  }

  // TODO: Implement API methods (authenticate, send invoice, get invoice, etc.)

  async getInvoice(invoiceId: string): Promise<unknown> {
    logger.info(`Fetching invoice: ${invoiceId}`);
    // TODO: Implement
    return null;
  }

  async sendInvoice(invoiceData: unknown): Promise<unknown> {
    logger.info('Sending invoice to KSeF');
    // TODO: Implement
    return null;
  }
}

export const ksefClient = new KsefClient();
