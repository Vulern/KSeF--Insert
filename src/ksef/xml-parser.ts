/**
 * KSeF XML Parser
 * Parsowanie XML FA-2 do obiektów TypeScript
 */

import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { logger } from '../logger.js';
import { KsefValidationError } from '../errors.js';
import type { KsefInvoice } from './types.js';

/**
 * XML Parser configuration for KSeF
 */
const parserOptions = {
  ignoreAttributes: false,
  preserveOrder: false,
  parseAttributeValue: true,
  parseTagValue: true,
  isArray: (name: string) => {
    return ['invoice', 'item', 'detail'].includes(name);
  },
};

const xmlParser = new XMLParser(parserOptions);
const xmlBuilder = new XMLBuilder({ ignoreAttributes: false });

/**
 * Parse KSeF XML response to typed invoice object
 */
export const parseKsefXml = (xmlContent: string): KsefInvoice => {
  logger.debug('Parsing KSeF XML');
  try {
    const parsed = xmlParser.parse(xmlContent);
    
    if (!parsed) {
      throw new KsefValidationError('Empty XML content');
    }

    logger.debug('XML parsed successfully');
    return parsed as KsefInvoice;
  } catch (error) {
    if (error instanceof KsefValidationError) {
      throw error;
    }
    logger.error('Failed to parse KSeF XML', error);
    throw new KsefValidationError(
      `XML parsing failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Parse generic XML to object
 */
export const xmlToObject = (xmlContent: string): Record<string, unknown> => {
  logger.debug('Converting XML to object');
  try {
    const parsed = xmlParser.parse(xmlContent);
    
    if (!parsed) {
      throw new KsefValidationError('Empty XML content');
    }

    return parsed as Record<string, unknown>;
  } catch (error) {
    logger.error('XML conversion failed', error);
    throw new KsefValidationError(
      `XML conversion failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Convert object to XML string
 */
export const objectToXml = (obj: Record<string, unknown>): string => {
  logger.debug('Converting object to XML');
  try {
    const xml = xmlBuilder.build(obj) as string;
    
    if (!xml) {
      throw new KsefValidationError('Failed to build XML');
    }

    return xml;
  } catch (error) {
    logger.error('XML building failed', error);
    throw new KsefValidationError(
      `XML building failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
};

/**
 * Extract specific field from XML object using path
 */
export const extractFromXml = (
  obj: Record<string, unknown>,
  path: string
): unknown => {
  logger.debug(`Extracting field from XML: ${path}`);
  
  try {
    const parts = path.split('.');
    let current: unknown = obj;

    for (const part of parts) {
      if (current === null || current === undefined) {
        return undefined;
      }

      if (typeof current === 'object' && part in current) {
        current = (current as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }

    return current;
  } catch (error) {
    logger.error('Field extraction failed', error);
    return undefined;
  }
};
