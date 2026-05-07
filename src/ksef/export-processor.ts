/**
 * Processes a decrypted KSeF export ZIP package.
 *
 * The ZIP produced by POST /invoices/exports contains:
 *   _metadata.json  – array of InvoiceMetadata (same shape as /invoices/query/metadata)
 *   *.xml           – one XML per invoice, named by KSeF number
 *
 * When the file-name convention differs from the KSeF number we fall back to
 * matching by iteration order (metadata[i] ↔ xml-files[i]).
 */

import AdmZip from 'adm-zip';
import { ksefLogger } from '../logger.js';
import { parseKsefXml } from './xml-parser.js';
import type { InvoiceMetadata } from './types.js';

export interface ExtractedInvoice {
  ksefNumber: string;
  xml: string;
  metadata: InvoiceMetadata;
}

/**
 * Extract all invoices from a decrypted export ZIP buffer.
 * Returns one entry per invoice with its raw XML and metadata.
 */
export function extractExportPackage(zipBuffer: Buffer): ExtractedInvoice[] {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries();

  // Collect metadata
  const metadataEntry = entries.find((e) => e.entryName === '_metadata.json');
  let metadataList: InvoiceMetadata[] = [];
  if (metadataEntry) {
    try {
      const raw = metadataEntry.getData().toString('utf-8');
      const parsed = JSON.parse(raw);
      metadataList = Array.isArray(parsed) ? parsed : (parsed.invoices ?? []);
    } catch (err) {
      ksefLogger.warn('Could not parse _metadata.json in export package', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } else {
    ksefLogger.warn('No _metadata.json found in export package — metadata will be empty');
  }

  // Build a lookup: ksefNumber → metadata
  const metaByKsefNumber = new Map<string, InvoiceMetadata>();
  for (const m of metadataList) {
    const key = (m.ksefNumber ?? m.invoiceReferenceNumber ?? '') as string;
    if (key) metaByKsefNumber.set(key, m);
  }

  // Collect XML entries (skip hidden files and _metadata.json)
  const xmlEntries = entries.filter(
    (e) => !e.isDirectory && e.entryName !== '_metadata.json' && !e.entryName.startsWith('.')
  );

  const results: ExtractedInvoice[] = [];

  for (let i = 0; i < xmlEntries.length; i++) {
    const entry = xmlEntries[i];
    const xml = entry.getData().toString('utf-8');

    // Derive KSeF number: strip extension from filename, then try metadata match
    const basename = entry.name.replace(/\.xml$/i, '');

    let metadata: InvoiceMetadata;
    let ksefNumber: string;

    if (metaByKsefNumber.has(basename)) {
      // Filename matches a KSeF number directly
      ksefNumber = basename;
      metadata = metaByKsefNumber.get(basename)!;
    } else {
      // Fall back to positional match: metadata[i] corresponds to xml-files[i]
      const positionalMeta = metadataList[i];
      ksefNumber =
        (positionalMeta?.ksefNumber ?? positionalMeta?.invoiceReferenceNumber ?? basename) as string;
      metadata = positionalMeta ?? {};

      // Try to extract from the XML itself as a last resort
      if (!ksefNumber) {
        try {
          const parsed = parseKsefXml(xml);
          ksefNumber = (parsed as any).ksefNumber ?? basename;
        } catch {
          ksefNumber = basename;
        }
      }
    }

    results.push({ ksefNumber, xml, metadata });
  }

  ksefLogger.info(`📦 Rozpakowano paczkę eksportu`, { total: results.length });
  return results;
}
