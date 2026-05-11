import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { KsefValidationError } from '../errors.js';

export type JpkVatFolderType = 'zakup' | 'sprzedaz';

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: false,
  parseAttributeValue: true,
  parseTagValue: true,
});

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: false,
});

function localName(name: string): string {
  const idx = name.indexOf(':');
  return idx >= 0 ? name.slice(idx + 1) : name;
}

function collectValuesByLocalName(node: unknown, out: Map<string, string[]>): void {
  if (node == null) return;
  if (typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) collectValuesByLocalName(item, out);
    return;
  }

  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const ln = localName(k);
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      const arr = out.get(ln) ?? [];
      arr.push(String(v));
      out.set(ln, arr);
    } else {
      collectValuesByLocalName(v, out);
    }
  }
}

function first(out: Map<string, string[]>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = out.get(k);
    if (v && v.length > 0) return v[0];
  }
  return undefined;
}

function normalizeNip(nip?: string): string {
  return (nip ?? '').replace(/\\D/g, '');
}

function normalizeDate(date?: string): string | undefined {
  if (!date) return undefined;
  const m = date.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

function asNumber(x: unknown): number | undefined {
  if (x == null) return undefined;
  const n = typeof x === 'number' ? x : Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function safeToken(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const v = value.trim();
  return v.length > 0 ? v : undefined;
}

function safeAddressLine(value: string | undefined): string | undefined {
  // W JPK_VAT(3) wiele pól ma minLength=1; pustych nie emitujemy.
  return safeToken(value);
}

export interface JpkVat3RowBase {
  contractorNip: string;
  contractorName: string;
  contractorAddress: string;
  documentNumber: string;
  issueDate?: string;
  saleDate?: string;
  net23?: number;
  vat23?: number;
}

/**
 * Best-effort extraction from KSeF FA(2) XML to data needed for JPK_VAT(3).
 * We rely on heuristics by local tag names (KSeF XML is namespaced and verbose).
 */
export function ksefInvoiceXmlToJpkVat3Row(params: {
  xml: string;
  folderType: JpkVatFolderType;
  companyNip: string;
  fallback?: {
    invoicingDate?: string;
    issueDate?: string;
    sellerNip?: string;
    buyerNip?: string;
  };
}): { kind: 'sprzedaz' | 'zakup'; row: JpkVat3RowBase } {
  const { xml, folderType, companyNip, fallback } = params;
  if (!xml) throw new KsefValidationError('Empty invoice XML (cannot transform to JPK_VAT)');

  const obj = xmlParser.parse(xml) as Record<string, unknown>;
  const values = new Map<string, string[]>();
  collectValuesByLocalName(obj, values);

  const docNo =
    first(values, ['P_2A', 'P_2', 'NrFaktury', 'NumerFaktury', 'InvoiceNumber', 'NrFa']) ??
    first(values, ['DowodSprzedazy', 'DowodZakupu']) ??
    undefined;
  if (!docNo) throw new KsefValidationError('Could not detect invoice number for JPK_VAT row');

  const issueDate = normalizeDate(first(values, ['DataWystawienia', 'IssueDate', 'P_1']) ?? fallback?.issueDate);
  const saleDate = normalizeDate(first(values, ['DataSprzedazy', 'InvoicingDate', 'P_6']) ?? fallback?.invoicingDate);

  // Most common in structured invoices:
  const net23 = asNumber(first(values, ['P_13_1', 'K_19'])) ?? asNumber(first(values, ['Net23', 'Netto23']));
  const vat23 = asNumber(first(values, ['P_14_1', 'K_20'])) ?? asNumber(first(values, ['Vat23', 'VAT23']));

  const sellerNip = normalizeNip(first(values, ['NIPSprzedawcy', 'NipSprzedawcy', 'SellerNIP', 'P_4B']) ?? fallback?.sellerNip);
  const buyerNip = normalizeNip(first(values, ['NIPNabywcy', 'NipNabywcy', 'BuyerNIP', 'P_5B']) ?? fallback?.buyerNip);
  const sellerName = first(values, ['NazwaSprzedawcy', 'PelnaNazwaSprzedawcy', 'SellerName', 'P_3C']);
  const buyerName = first(values, ['NazwaNabywcy', 'PelnaNazwaNabywcy', 'BuyerName', 'P_3A']);
  const sellerAddr = first(values, ['AdresSprzedawcy', 'SellerAddress', 'P_3D']);
  const buyerAddr = first(values, ['AdresNabywcy', 'BuyerAddress', 'P_3B']);

  const company = normalizeNip(companyNip);

  // In JPK_VAT(3) row "kontrahent" depends on sales/purchase view:
  // - sprzedaz: kontrahent = buyer
  // - zakup:    kontrahent = seller
  const isSales = folderType === 'sprzedaz';
  const contractorNip = isSales ? (buyerNip || '') : (sellerNip || '');
  const contractorName = (isSales ? buyerName : sellerName) ?? '';
  const contractorAddress = (isSales ? buyerAddr : sellerAddr) ?? '';

  return {
    kind: folderType,
    row: {
      contractorNip: normalizeNip(contractorNip),
      contractorName: contractorName.trim(),
      contractorAddress: contractorAddress.trim(),
      documentNumber: docNo.trim(),
      issueDate,
      saleDate,
      net23,
      vat23,
    },
  };
}

export function buildJpkVat3Xml(params: {
  month: string; // YYYY-MM
  podmiotNip: string;
  podmiotPelnaNazwa?: string;
  rows: Array<{ kind: JpkVatFolderType; row: JpkVat3RowBase }>;
  systemName?: string;
}): string {
  const { month, podmiotNip, podmiotPelnaNazwa, rows, systemName } = params;

  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new KsefValidationError(`Invalid month format: ${month} (expected YYYY-MM)`);

  const year = Number(m[1]);
  const monthNo = Number(m[2]);
  const from = new Date(Date.UTC(year, monthNo - 1, 1));
  const to = new Date(Date.UTC(year, monthNo, 0));
  const dataOd = from.toISOString().slice(0, 10);
  const dataDo = to.toISOString().slice(0, 10);

  const salesRows = rows.filter((r) => r.kind === 'sprzedaz').map((r) => r.row);
  const buyRows = rows.filter((r) => r.kind === 'zakup').map((r) => r.row);

  let lpS = 0;
  const sprzedazWiersz = salesRows.map((r) => {
    lpS++;
    const k19 = r.net23 ?? 0;
    const k20 = r.vat23 ?? 0;
    const out: Record<string, unknown> = {
      'tns:LpSprzedazy': lpS,
      'tns:NrKontrahenta': safeToken(r.contractorNip) ?? '0000000000',
      'tns:NazwaKontrahenta': safeToken(r.contractorName) ?? 'BRAK_DANYCH',
      'tns:AdresKontrahenta': safeAddressLine(r.contractorAddress) ?? 'BRAK_DANYCH',
      'tns:DowodSprzedazy': safeToken(r.documentNumber) ?? `DOK_${lpS}`,
      'tns:DataWystawienia': r.issueDate ?? r.saleDate ?? dataDo,
      'tns:DataSprzedazy': r.saleDate ?? r.issueDate ?? dataDo,
      'tns:K_19': Number(k19.toFixed(2)),
      'tns:K_20': Number(k20.toFixed(2)),
    };
    return out;
  });

  let lpZ = 0;
  const zakupWiersz = buyRows.map((r) => {
    lpZ++;
    const k45 = r.net23 ?? 0;
    const k46 = r.vat23 ?? 0;
    const out: Record<string, unknown> = {
      'tns:LpZakupu': lpZ,
      'tns:NrDostawcy': safeToken(r.contractorNip) ?? '0000000000',
      'tns:NazwaDostawcy': safeToken(r.contractorName) ?? 'BRAK_DANYCH',
      'tns:AdresDostawcy': safeAddressLine(r.contractorAddress) ?? 'BRAK_DANYCH',
      'tns:DowodZakupu': safeToken(r.documentNumber) ?? `DOK_${lpZ}`,
      'tns:DataZakupu': r.saleDate ?? r.issueDate ?? dataDo,
      'tns:DataWplywu': r.issueDate ?? r.saleDate ?? dataDo,
      'tns:K_45': Number(k45.toFixed(2)),
      'tns:K_46': Number(k46.toFixed(2)),
    };
    return out;
  });

  const podatekNalezny = sprzedazWiersz.reduce((s, r) => s + Number((r['tns:K_20'] as number) ?? 0), 0);
  const podatekNaliczony = zakupWiersz.reduce((s, r) => s + Number((r['tns:K_46'] as number) ?? 0), 0);

  const pelnaNazwa = safeToken(podmiotPelnaNazwa) ?? `Podmiot_${podmiotNip}`;

  const doc: Record<string, unknown> = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    'tns:JPK': {
      '@_xmlns:etd': 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2016/01/25/eD/DefinicjeTypy/',
      '@_xmlns:tns': 'http://jpk.mf.gov.pl/wzor/2017/11/13/1113/',
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'tns:Naglowek': {
        'tns:KodFormularza': {
          '@_kodSystemowy': 'JPK_VAT (3)',
          '@_wersjaSchemy': '1-1',
          '#text': 'JPK_VAT',
        },
        'tns:WariantFormularza': 3,
        // 0 = złożenie pierwotne (w przykładzie MF); Insert zwykle akceptuje 0/1
        'tns:CelZlozenia': 0,
        'tns:DataWytworzeniaJPK': new Date().toISOString().slice(0, 19),
        'tns:DataOd': dataOd,
        'tns:DataDo': dataDo,
        'tns:NazwaSystemu': systemName ?? 'KSeF--Insert',
      },
      'tns:Podmiot1': {
        'tns:NIP': podmiotNip,
        'tns:PelnaNazwa': pelnaNazwa,
      },
      // NOTE: XSD defines the sequence as:
      // SprzedazWiersz* then SprzedazCtrl (required only if SprzedazWiersz exists),
      // ZakupWiersz* then ZakupCtrl (required only if ZakupWiersz exists).
      // When we generate separate files (sprzedaz/zakup) we MUST omit the empty side's Ctrl.
      ...(sprzedazWiersz.length > 0
        ? {
            'tns:SprzedazWiersz': sprzedazWiersz,
            'tns:SprzedazCtrl': {
              'tns:LiczbaWierszySprzedazy': sprzedazWiersz.length,
              'tns:PodatekNalezny': Number(podatekNalezny.toFixed(2)),
            },
          }
        : {}),
      ...(zakupWiersz.length > 0
        ? {
            'tns:ZakupWiersz': zakupWiersz,
            'tns:ZakupCtrl': {
              'tns:LiczbaWierszyZakupow': zakupWiersz.length,
              'tns:PodatekNaliczony': Number(podatekNaliczony.toFixed(2)),
            },
          }
        : {}),
    },
  };

  const built = xmlBuilder.build(doc) as string;
  if (!built) throw new KsefValidationError('Failed to build JPK_VAT XML');
  return built.startsWith('<?xml') ? built : `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\\n${built}`;
}

