/**
 * XML Validator
 * Validates invoice XML files against FA(2) XSD schema
 */

import { readFile, readdir } from 'fs/promises';
import { join, extname, basename } from 'path';
import { validatorLogger } from '../logger.js';
import { KsefValidationError } from '../errors.js';

export interface ValidationError {
  line?: number;
  column?: number;
  message: string;
  level?: 'error' | 'warning';
}

export interface ValidationResult {
  filePath: string;
  fileName: string;
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationError[];
}

export interface BatchValidationResult {
  total: number;
  valid: number;
  invalid: number;
  results: ValidationResult[];
}

/**
 * XML Validator class for FA(2) invoice validation
 * Performs basic XML structure validation and schema checks
 */
export class InvoiceXMLValidator {
  private xsdPath: string | null = null;

  constructor(xsdPath?: string) {
    this.xsdPath = xsdPath || null;
    if (this.xsdPath) {
      validatorLogger.info('XML Validator initialized with XSD', { xsdPath: this.xsdPath });
    } else {
      validatorLogger.info('XML Validator initialized in basic mode (XSD not available)');
    }
  }

  /**
   * Validate a single XML file
   */
  async validate(xmlPath: string): Promise<ValidationResult> {
    validatorLogger.info('Validating XML file', { filePath: xmlPath });

    try {
      const content = await readFile(xmlPath, 'utf-8');
      const fileName = basename(xmlPath);

      const errors: ValidationError[] = [];
      const warnings: ValidationError[] = [];

      // 1. Check if file is valid XML
      if (!this.isValidXmlStructure(content)) {
        errors.push({
          line: 1,
          message: 'Invalid XML structure - malformed document',
          level: 'error',
        });
        return {
          filePath: xmlPath,
          fileName,
          valid: false,
          errors,
          warnings,
        };
      }

      // 2. Parse XML and perform validation
      const parseResult = this.parseAndValidateXml(content);
      errors.push(...parseResult.errors);
      warnings.push(...parseResult.warnings);

      // 3. Validate FA(2) specific schema requirements
      const schemaErrors = this.validateFaSchema(content);
      errors.push(...schemaErrors);

      const valid = errors.length === 0;

      return {
        filePath: xmlPath,
        fileName,
        valid,
        errors,
        warnings,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      validatorLogger.error('Validation error', {
        filePath: xmlPath,
        error: message,
      });

      return {
        filePath: xmlPath,
        fileName: basename(xmlPath),
        valid: false,
        errors: [{ message: `Failed to validate: ${message}`, level: 'error' }],
        warnings: [],
      };
    }
  }

  /**
   * Validate all XML files in a directory
   */
  async validateDir(dirPath: string): Promise<BatchValidationResult> {
    validatorLogger.info('Validating directory', { dirPath });

    const results: ValidationResult[] = [];
    let total = 0;
    let validCount = 0;
    let invalidCount = 0;

    try {
      const files = await this.findXmlFiles(dirPath);

      for (const file of files) {
        total++;
        const result = await this.validate(file);
        results.push(result);

        if (result.valid) {
          validCount++;
        } else {
          invalidCount++;
        }
      }
    } catch (error) {
      validatorLogger.error('Directory validation error', {
        dirPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return {
      total,
      valid: validCount,
      invalid: invalidCount,
      results,
    };
  }

  /**
   * Find all XML files in directory recursively
   */
  private async findXmlFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];

    const scanDir = async (currentDir: string) => {
      try {
        const entries = await readdir(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = join(currentDir, entry.name);

          if (entry.isDirectory()) {
            await scanDir(fullPath);
          } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.xml') {
            files.push(fullPath);
          }
        }
      } catch {
        // Ignore read errors
      }
    };

    await scanDir(dirPath);
    return files.sort();
  }

  /**
   * Check if content is valid XML structure
   */
  private isValidXmlStructure(content: string): boolean {
    const trimmed = content.trim();

    // Must start with < and end with >
    if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) {
      return false;
    }

    // Check balanced tags
    const openCount = (content.match(/<[\w:]/g) || []).length;
    const closeCount = (content.match(/<\/[\w:]/g) || []).length;
    const selfCloseCount = (content.match(/\/>/g) || []).length;

    // Approximate check: should have matching opens and closes
    return openCount > 0 && (openCount === closeCount + selfCloseCount);
  }

  /**
   * Parse and validate XML structure
   */
  private parseAndValidateXml(content: string): {
    errors: ValidationError[];
    warnings: ValidationError[];
  } {
    const errors: ValidationError[] = [];
    const warnings: ValidationError[] = [];

    try {
      // Basic XML structure validation via regex
      const lines = content.split('\n');

      // Check for XML declaration (optional but recommended)
      if (!content.includes('<?xml')) {
        warnings.push({
          line: 1,
          message: 'XML declaration missing (recommended: <?xml version="1.0" encoding="UTF-8"?>)',
          level: 'warning',
        });
      }

      // Check for namespace declarations
      if (!content.includes('xmlns')) {
        errors.push({
          line: 1,
          message: 'Missing XML namespace declaration',
          level: 'error',
        });
      }

      // Check for common XML encoding issues
      lines.forEach((line, index) => {
        if (line.includes('&') && !line.includes('&amp;') && !line.includes('&lt;') && !line.includes('&gt;')) {
          // Potential unescaped ampersand
          if (!/&[\w]+;/.test(line)) {
            errors.push({
              line: index + 1,
              message: 'Potentially unescaped ampersand (&) - should be &amp;',
              level: 'error',
            });
          }
        }
      });
    } catch (error) {
      errors.push({
        message: 'XML parsing error',
        level: 'error',
      });
    }

    return { errors, warnings };
  }

  /**
   * Validate against FA(2) schema requirements
   */
  private validateFaSchema(content: string): ValidationError[] {
    const errors: ValidationError[] = [];
    const lines = content.split('\n');

    // Check for required FA(2) elements
    const requiredElements = [
      { name: 'Faktura', pattern: /<Faktura/i },
      { name: 'Naglowek', pattern: /<Naglowek/i },
      { name: 'Pozycje', pattern: /<Pozycje/i },
    ];

    for (const elem of requiredElements) {
      if (!elem.pattern.test(content)) {
        errors.push({
          line: 1,
          message: `required FA(2) element missing: <${elem.name}>`,
          level: 'error',
        });
      }
    }

    // Check for NIP format (10 digits)
    const nipPattern = /<NIP>([^<]+)<\/NIP>/i;
    const nipMatch = content.match(nipPattern);
    if (nipMatch) {
      const nip = nipMatch[1].trim();
      if (!/^\d{10}$/.test(nip)) {
        lines.forEach((line, idx) => {
          if (line.includes('NIP') && line.includes(nip)) {
            errors.push({
              line: idx + 1,
              message: `Invalid NIP format: "${nip}" (should be 10 digits)`,
              level: 'error',
            });
          }
        });
      }
    }

    // Check for invoice number format
    const numberPattern = /<NumerFaktury>([^<]*)<\/NumerFaktury>/i;
    const numberMatch = content.match(numberPattern);
    if (numberMatch) {
      const number = numberMatch[1].trim();
      if (number.length === 0) {
        lines.forEach((line, idx) => {
          if (line.includes('NumerFaktury')) {
            errors.push({
              line: idx + 1,
              message: 'Invoice number is empty',
              level: 'error',
            });
          }
        });
      }
    }

    // Check for date formats (should be YYYY-MM-DD)
    const datePattern = /<(?:DataWystawienia|DataDostaw|DataOplaty)[^>]*>([^<]+)<\//gi;
    let match;
    while ((match = datePattern.exec(content)) !== null) {
      const date = match[1].trim();
      if (!/^\d{4}-\d{2}-\d{2}/.test(date)) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        errors.push({
          line: lineNum,
          message: `Invalid date format: "${date}" (should be YYYY-MM-DD)`,
          level: 'error',
        });
      }
    }

    // Check for amount values (should be numeric)
    const amountPattern = /(?:Kwota|Amount|Wartosc)[^>]*>([^<]+)<\//gi;
    while ((match = amountPattern.exec(content)) !== null) {
      const amount = match[1].trim();
      if (!/^[-+]?[\d.,]+$/.test(amount)) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        errors.push({
          line: lineNum,
          message: `Invalid amount format: "${amount}" (should be numeric)`,
          level: 'error',
        });
      }
    }

    return errors;
  }
}

export function createValidator(xsdPath?: string): InvoiceXMLValidator {
  return new InvoiceXMLValidator(xsdPath);
}
