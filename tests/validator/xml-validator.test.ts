/**
 * XML Validator Tests
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { InvoiceXMLValidator, ValidationResult, BatchValidationResult } from '../../src/validator/xml-validator.js';

describe('XML Validator', () => {
  let validator: InvoiceXMLValidator;
  let testDir: string;

  beforeAll(async () => {
    validator = new InvoiceXMLValidator();
    testDir = await mkdtemp(join(tmpdir(), 'xml-validator-'));
  });

  afterAll(async () => {
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Single File Validation', () => {
    it('should validate correct FA(2) XML', async () => {
      const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <UBLVersionID>2.1</UBLVersionID>
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje>
    <Pozycja>
      <Id>1</Id>
    </Pozycja>
  </Pozycje>
  <Podmioty>
    <Sprzedawca>
      <NIP>5213000001</NIP>
    </Sprzedawca>
    <Nabywca>
      <NIP>7891234567</NIP>
    </Nabywca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'valid.xml');
      await writeFile(filePath, validXml);

      const result = await validator.validate(filePath);

      expect(result).toBeDefined();
      expect(result.filePath).toBe(filePath);
      expect(result.fileName).toBe('valid.xml');
      expect(result.valid).toBe(true);
      expect(result.errors.length).toBe(0);
    });

    it('should reject malformed XML', async () => {
      const invalidXml = '<Faktura><Naglowek></Faktura>';

      const filePath = join(testDir, 'malformed.xml');
      await writeFile(filePath, invalidXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject XML without namespace', async () => {
      const noNamespaceXml = `<?xml version="1.0"?>
<Faktura>
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
  </Naglowek>
</Faktura>`;

      const filePath = join(testDir, 'no-namespace.xml');
      await writeFile(filePath, noNamespaceXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('namespace'))).toBe(true);
    });

    it('should reject missing required FA(2) elements', async () => {
      const missingElementsXml = `<?xml version="1.0"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
  </Naglowek>
</Faktura>`;

      const filePath = join(testDir, 'missing-elements.xml');
      await writeFile(filePath, missingElementsXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('required'))).toBe(true);
    });

    it('should reject invalid NIP format', async () => {
      const invalidNipXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje>
    <Pozycja><Id>1</Id></Pozycja>
  </Pozycje>
  <Podmioty>
    <Sprzedawca>
      <NIP>123</NIP>
    </Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'invalid-nip.xml');
      await writeFile(filePath, invalidNipXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('NIP'))).toBe(true);
    });

    it('should reject empty invoice number', async () => {
      const emptyNumberXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury></NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'empty-number.xml');
      await writeFile(filePath, emptyNumberXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('empty'))).toBe(true);
    });

    it('should reject invalid date format', async () => {
      const invalidDateXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>15-01-2024</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'invalid-date.xml');
      await writeFile(filePath, invalidDateXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes('date') || e.message.includes('format'))).toBe(true);
    });

    it('should handle non-XML file gracefully', async () => {
      const notXml = 'This is not an XML file';

      const filePath = join(testDir, 'not-xml.txt');
      await writeFile(filePath, notXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should report line numbers for errors', async () => {
      const multiLineXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <DataWystawienia>invalid-date</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
</Faktura>`;

      const filePath = join(testDir, 'multiline.xml');
      await writeFile(filePath, multiLineXml);

      const result = await validator.validate(filePath);

      expect(result.valid).toBe(false);
      const errorWithLine = result.errors.find((e) => e.line !== undefined);
      expect(errorWithLine).toBeDefined();
    });

    it('should generate warnings for missing XML declaration', async () => {
      const noDeclarationXml = `<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'no-declaration.xml');
      await writeFile(filePath, noDeclarationXml);

      const result = await validator.validate(filePath);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.message.includes('XML declaration'))).toBe(true);
    });
  });

  describe('Batch Directory Validation', () => {
    it('should validate directory with multiple files', async () => {
      const subDir = join(testDir, 'batch');
      await mkdir(subDir, { recursive: true });

      // Create valid files
      for (let i = 0; i < 3; i++) {
        const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <UBLVersionID>2.1</UBLVersionID>
  <Naglowek>
    <NumerFaktury>INV/2024/00${i + 1}</NumerFaktury>
    <DataWystawienia>2024-01-${String(i + 1).padStart(2, '0')}</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;
        await writeFile(join(subDir, `valid-${i + 1}.xml`), validXml);
      }

      // Create invalid files
      for (let i = 0; i < 2; i++) {
        const invalidXml = `<Faktura><Naglowek></Naglowek></Faktura>`;
        await writeFile(join(subDir, `invalid-${i + 1}.xml`), invalidXml);
      }

      const result = await validator.validateDir(subDir);

      expect(result).toBeDefined();
      expect(result.total).toBe(5);
      expect(result.valid).toBe(3);
      expect(result.invalid).toBe(2);
      expect(result.results.length).toBe(5);
    });

    it('should handle empty directory', async () => {
      const emptyDir = join(testDir, 'empty');
      await mkdir(emptyDir, { recursive: true });

      const result = await validator.validateDir(emptyDir);

      expect(result.total).toBe(0);
      expect(result.valid).toBe(0);
      expect(result.invalid).toBe(0);
      expect(result.results.length).toBe(0);
    });

    it('should recursively scan subdirectories', async () => {
      const nestedDir = join(testDir, 'nested');
      await mkdir(join(nestedDir, 'level1', 'level2'), { recursive: true });

      const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <UBLVersionID>2.1</UBLVersionID>
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      await writeFile(join(nestedDir, 'level1', 'level2', 'test.xml'), validXml);

      const result = await validator.validateDir(nestedDir);

      expect(result.total).toBe(1);
      expect(result.valid).toBe(1);
    });

    it('should provide detailed results for each file', async () => {
      const resultsDir = join(testDir, 'results');
      await mkdir(resultsDir, { recursive: true });

      const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <UBLVersionID>2.1</UBLVersionID>
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      await writeFile(join(resultsDir, 'test.xml'), validXml);

      const result = await validator.validateDir(resultsDir);

      expect(result.results.length).toBe(1);
      const fileResult = result.results[0];
      expect(fileResult.filePath).toBeDefined();
      expect(fileResult.fileName).toBeDefined();
      expect(fileResult.valid).toBeDefined();
      expect(fileResult.errors).toBeDefined();
      expect(fileResult.warnings).toBeDefined();
    });
  });

  describe('Error Messages', () => {
    it('should provide readable error messages', async () => {
      const invalidXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <DataWystawienia>2024-1-15</DataWystawienia>
  </Naglowek>
</Faktura>`;

      const filePath = join(testDir, 'error-msg.xml');
      await writeFile(filePath, invalidXml);

      const result = await validator.validate(filePath);

      expect(result.errors.length).toBeGreaterThan(0);
      result.errors.forEach((error) => {
        expect(error.message).toBeDefined();
        expect(error.message.length).toBeGreaterThan(0);
      });
    });

    it('should classify errors as error or warning', async () => {
      const warningXml = `<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'classification.xml');
      await writeFile(filePath, warningXml);

      const result = await validator.validate(filePath);

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.every((w) => w.level === 'warning')).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large XML files', async () => {
      let largeXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje>`;

      // Add many line items
      for (let i = 0; i < 100; i++) {
        largeXml += `<Pozycja><Id>${i}</Id></Pozycja>`;
      }

      largeXml += `  </Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'large.xml');
      await writeFile(filePath, largeXml);

      const result = await validator.validate(filePath);

      expect(result).toBeDefined();
      expect(result.filePath).toBe(filePath);
    });

    it('should handle special characters in fields', async () => {
      const specialCharsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury>INV/2024/001-Ąćęłńóśźż</NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'special-chars.xml');
      await writeFile(filePath, specialCharsXml);

      const result = await validator.validate(filePath);

      expect(result).toBeDefined();
      // Polish characters should be handled
    });

    it('should handle XML with CDATA sections', async () => {
      const cdataXml = `<?xml version="1.0" encoding="UTF-8"?>
<Faktura xmlns="urn:cec:names:specification:ubl:schema:xsd:Invoice-2">
  <Naglowek>
    <NumerFaktury><![CDATA[INV/2024/001]]></NumerFaktury>
    <DataWystawienia>2024-01-15</DataWystawienia>
  </Naglowek>
  <Pozycje><Pozycja><Id>1</Id></Pozycja></Pozycje>
  <Podmioty>
    <Sprzedawca><NIP>5213000001</NIP></Sprzedawca>
  </Podmioty>
</Faktura>`;

      const filePath = join(testDir, 'cdata.xml');
      await writeFile(filePath, cdataXml);

      const result = await validator.validate(filePath);

      expect(result).toBeDefined();
    });
  });
});
