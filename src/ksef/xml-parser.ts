/**
 * KSeF XML Parser
 * Parsowanie XML FA-2 do obiektów TypeScript
 */

import { XMLParser } from 'fast-xml-parser';
import { logger } from '../logger.js';
import { KsefInvoice } from './types.js';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
});

export const parseKsefXml = (xmlContent: string): KsefInvoice => {
  logger.debug('Parsing KSeF XML');
  try {
    // TODO: Implement XML parsing to KsefInvoice
    const parsed = xmlParser.parse(xmlContent);
    return parsed as KsefInvoice;
  } catch (error) {
    logger.error('Failed to parse KSeF XML', error);
    throw error;
  }
};

export const xmlToObject = (xmlContent: string): unknown => {
  return xmlParser.parse(xmlContent);
};
