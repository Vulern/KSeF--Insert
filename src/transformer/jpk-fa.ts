import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import { KsefValidationError } from '../errors.js';

export type JpkFolderType = 'zakup' | 'sprzedaz';

export interface JpkFaPodmiot {
  nip: string;
  pelnaNazwa?: string;
  // Adres w JPK_FA jest w typach `etd:*`, ale Insert praktycznie akceptuje samą treść.
  // Jeśli nie umiemy go wiarygodnie złożyć z KSeF, pomijamy.
  adres?: {
    kodKraju?: string;
    wojewodztwo?: string;
    powiat?: string;
    gmina?: string;
    ulica?: string;
    nrDomu?: string;
    miejscowosc?: string;
    kodPocztowy?: string;
  };
}

export interface JpkFaInvoiceLine {
  invoiceNumber: string;
  name?: string;
  unit?: string;
  quantity?: number;
  net?: number;
  gross?: number;
  vatRate?: number;
}

export interface JpkFaInvoiceEntry {
  invoiceNumber: string;
  issueDate?: string; // YYYY-MM-DD
  saleDate?: string;  // YYYY-MM-DD
  currency?: string;
  seller: JpkFaPodmiot;
  buyer: JpkFaPodmiot;
  net23?: number;
  vat23?: number;
  gross?: number;
  kind?: 'VAT' | 'KOREKTA' | string;
  correctedInvoiceNumber?: string;
  correctedPeriod?: string;
  lines: JpkFaInvoiceLine[];
}

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
  return (nip ?? '').replace(/\D/g, '');
}

function normalizeDate(date?: string): string | undefined {
  if (!date) return undefined;
  // Try to accept `YYYY-MM-DD` or ISO. If anything else, return undefined.
  const m = date.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

function asNumber(x: unknown): number | undefined {
  if (x == null) return undefined;
  const n = typeof x === 'number' ? x : Number(String(x).replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Best-effort extraction from KSeF FA(2) XML to the subset required by Insert's JPK_FA import.
 * The FA(2) schema is rich and namespaced; we intentionally use heuristics over local tag names.
 */
export function ksefInvoiceXmlToJpkFaEntry(params: {
  xml: string;
  folderType: JpkFolderType;
  companyNip: string;
  fallback?: {
    invoicingDate?: string;
    issueDate?: string;
    sellerNip?: string;
    buyerNip?: string;
  };
}): JpkFaInvoiceEntry {
  const { xml, folderType, companyNip, fallback } = params;
  if (!xml) throw new KsefValidationError('Empty invoice XML (cannot transform to JPK_FA)');

  const obj = xmlParser.parse(xml) as Record<string, unknown>;
  const values = new Map<string, string[]>();
  collectValuesByLocalName(obj, values);

  const invoiceNumber =
    first(values, ['P_2A', 'P_2', 'NrFaktury', 'NumerFaktury', 'InvoiceNumber', 'NrFa']) ??
    first(values, ['KSeFReferenceNumber', 'KsefNumber', 'ReferenceNumber']) ??
    undefined;

  if (!invoiceNumber) {
    throw new KsefValidationError('Could not detect invoice number in KSeF XML (needed for JPK_FA)');
  }

  const currency = first(values, ['KodWaluty', 'CurrencyCode', 'Waluta', 'KodWalutyFaktury']) ?? 'PLN';
  const issueDate = normalizeDate(first(values, ['DataWystawienia', 'IssueDate', 'P_1']) ?? fallback?.issueDate);
  const saleDate = normalizeDate(first(values, ['DataSprzedazy', 'InvoicingDate', 'P_6']) ?? fallback?.invoicingDate);

  const sellerNip = normalizeNip(first(values, ['NIP', 'Nip', 'SellerNIP', 'SprzedawcaNIP']) ?? fallback?.sellerNip);
  const buyerNip = normalizeNip(first(values, ['NIPNabywcy', 'BuyerNIP', 'NipNabywcy', 'NabywcaNIP']) ?? fallback?.buyerNip);

  // Heuristic: in FA(2) there may be multiple NIP fields; fallback to company NIP positioning.
  const company = normalizeNip(companyNip);
  const resolvedSellerNip =
    folderType === 'sprzedaz'
      ? (sellerNip || company)
      : (sellerNip || first(values, ['NIPSprzedawcy', 'NipSprzedawcy']) || '');
  const resolvedBuyerNip =
    folderType === 'zakup'
      ? (buyerNip || company)
      : (buyerNip || first(values, ['NIPNabywcy', 'NipNabywcy']) || '');

  const sellerName = first(values, ['PelnaNazwaSprzedawcy', 'NazwaSprzedawcy', 'Sprzedawca', 'SellerName', 'P_3C']);
  const buyerName = first(values, ['PelnaNazwaNabywcy', 'NazwaNabywcy', 'Nabywca', 'BuyerName', 'P_3A']);

  const kind = first(values, ['RodzajFaktury', 'Type', 'TypFaktury']) ?? 'VAT';

  // Totals: try to locate explicit totals; otherwise compute from any net/vat/gross numbers we can recognize.
  const gross =
    asNumber(first(values, ['P_15', 'SumaBrutto', 'KwotaBrutto', 'GrossAmount'])) ??
    undefined;

  const net23 =
    asNumber(first(values, ['P_13_1', 'Net23', 'Netto23', 'KwotaNetto23'])) ??
    asNumber(first(values, ['SumaNetto', 'KwotaNetto', 'NetAmount']));

  const vat23 =
    asNumber(first(values, ['P_14_1', 'Vat23', 'VAT23', 'KwotaVAT23'])) ??
    asNumber(first(values, ['SumaVAT', 'KwotaVAT', 'VatAmount']));

  const resolvedGross =
    gross ??
    (net23 != null && vat23 != null ? Number((net23 + vat23).toFixed(2)) : undefined);

  const line: JpkFaInvoiceLine = {
    invoiceNumber,
    name: first(values, ['NazwaTowaruUslugi', 'Nazwa', 'Opis', 'P_7']) ?? 'Pozycja 1',
    unit: first(values, ['JednostkaMiary', 'JM', 'P_8A']) ?? 'szt',
    quantity: asNumber(first(values, ['Ilosc', 'Quantity', 'P_8B'])) ?? 1,
    net: net23,
    gross: resolvedGross,
    vatRate: asNumber(first(values, ['StawkaVAT', 'VatRate', 'P_12'])) ?? 23,
  };

  return {
    invoiceNumber,
    issueDate,
    saleDate,
    currency,
    seller: { nip: normalizeNip(resolvedSellerNip), pelnaNazwa: sellerName ?? undefined },
    buyer: { nip: normalizeNip(resolvedBuyerNip), pelnaNazwa: buyerName ?? undefined },
    net23: net23 != null ? Number(net23.toFixed(2)) : undefined,
    vat23: vat23 != null ? Number(vat23.toFixed(2)) : undefined,
    gross: resolvedGross != null ? Number(resolvedGross.toFixed(2)) : undefined,
    kind,
    lines: [line],
  };
}

export function buildJpkFaXml(params: {
  month: string; // YYYY-MM
  podmiot: JpkFaPodmiot;
  invoices: JpkFaInvoiceEntry[];
}): string {
  const { month, podmiot, invoices } = params;
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new KsefValidationError(`Invalid month format: ${month} (expected YYYY-MM)`);

  const year = Number(m[1]);
  const monthNo = Number(m[2]);
  const from = new Date(Date.UTC(year, monthNo - 1, 1));
  const to = new Date(Date.UTC(year, monthNo, 0)); // last day of month

  const dataOd = from.toISOString().slice(0, 10);
  const dataDo = to.toISOString().slice(0, 10);

  const faktury = invoices.map((inv) => {
    const sellerNip = inv.seller.nip || podmiot.nip;
    const buyerNip = inv.buyer.nip || '';
    return {
      'tns:KodWaluty': inv.currency ?? 'PLN',
      'tns:P_1': inv.issueDate ?? inv.saleDate ?? dataDo,
      'tns:P_2A': inv.invoiceNumber,
      ...(inv.buyer.pelnaNazwa ? { 'tns:P_3A': inv.buyer.pelnaNazwa } : {}),
      ...(inv.seller.pelnaNazwa ? { 'tns:P_3C': inv.seller.pelnaNazwa } : {}),
      ...(sellerNip ? { 'tns:P_4B': sellerNip } : {}),
      ...(buyerNip ? { 'tns:P_5B': buyerNip } : {}),
      ...(inv.saleDate ? { 'tns:P_6': inv.saleDate } : {}),
      ...(inv.net23 != null ? { 'tns:P_13_1': inv.net23.toFixed(2) } : {}),
      ...(inv.vat23 != null ? { 'tns:P_14_1': inv.vat23.toFixed(2) } : {}),
      ...(inv.gross != null ? { 'tns:P_15': inv.gross.toFixed(2) } : {}),
      'tns:RodzajFaktury': inv.kind ?? 'VAT',
      ...(inv.kind === 'KOREKTA' && inv.correctedInvoiceNumber ? { 'tns:NrFaKorygowanej': inv.correctedInvoiceNumber } : {}),
      ...(inv.kind === 'KOREKTA' && inv.correctedPeriod ? { 'tns:OkresFaKorygowanej': inv.correctedPeriod } : {}),
    };
  });

  const fakturaWiersze: Array<Record<string, unknown>> = [];
  let wartoscWierszyFaktur = 0;
  for (const inv of invoices) {
    for (const ln of inv.lines) {
      const rowValue = ln.gross ?? ln.net ?? 0;
      wartoscWierszyFaktur += rowValue;
      fakturaWiersze.push({
        'tns:P_2B': ln.invoiceNumber,
        ...(ln.name ? { 'tns:P_7': ln.name } : {}),
        ...(ln.unit ? { 'tns:P_8A': ln.unit } : {}),
        ...(ln.quantity != null ? { 'tns:P_8B': String(ln.quantity) } : {}),
        ...(ln.net != null ? { 'tns:P_11': Number(ln.net).toFixed(2) } : {}),
        ...(ln.gross != null ? { 'tns:P_11A': Number(ln.gross).toFixed(2) } : {}),
        ...(ln.vatRate != null ? { 'tns:P_12': String(Math.round(ln.vatRate)) } : {}),
      });
    }
  }

  const wartoscFaktur = invoices.reduce((sum, inv) => sum + (inv.gross ?? 0), 0);

  // Build the XML object with namespaces matching the working Insert import example.
  const doc: Record<string, unknown> = {
    '?xml': {
      '@_version': '1.0',
      '@_encoding': 'UTF-8',
    },
    'tns:JPK': {
      '@_xmlns:tns': 'http://jpk.mf.gov.pl/wzor/2022/02/17/02171/',
      '@_xmlns:etd': 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2018/08/24/eD/DefinicjeTypy/',
      // In the provided example this attribute is `xmlns:schemaLocation` (not `xsi:schemaLocation`)
      '@_xmlns:schemaLocation': 'https://www.gov.pl/attachment/aaa27be2-3663-46cd-bf53-f8925f0170b3',
      'tns:Naglowek': {
        'tns:KodFormularza': {
          '@_kodSystemowy': 'JPK_FA (4)',
          '@_wersjaSchemy': '1-0',
          '#text': 'JPK_FA',
        },
        'tns:WariantFormularza': 4,
        'tns:CelZlozenia': 1,
        'tns:DataWytworzeniaJPK': new Date().toISOString().slice(0, 19),
        'tns:DataOd': dataOd,
        'tns:DataDo': dataDo,
      },
      'tns:Podmiot1': {
        'tns:IdentyfikatorPodmiotu': {
          'tns:NIP': podmiot.nip,
          ...(podmiot.pelnaNazwa ? { 'tns:PelnaNazwa': podmiot.pelnaNazwa } : {}),
        },
      },
      ...(faktury.length > 0 ? { 'tns:Faktura': faktury } : {}),
      'tns:FakturaCtrl': {
        'tns:LiczbaFaktur': faktury.length,
        'tns:WartoscFaktur': Number(wartoscFaktur.toFixed(2)),
      },
      ...(fakturaWiersze.length > 0 ? { 'tns:FakturaWiersz': fakturaWiersze } : {}),
      'tns:FakturaWierszCtrl': {
        'tns:LiczbaWierszyFaktur': fakturaWiersze.length,
        // Insert wygląda na to, że nie wymaga tej sumy do importu; zostawiamy 0 gdy nie umiemy policzyć.
        'tns:WartoscWierszyFaktur': Number(wartoscWierszyFaktur.toFixed(2)),
      },
    },
  };

  // fast-xml-parser's builder doesn't auto-handle the `?xml` prolog in all configs,
  // so we manually prepend it for maximal compatibility.
  const built = xmlBuilder.build(doc) as string;
  if (!built) throw new KsefValidationError('Failed to build JPK_FA XML');

  // Ensure prolog exists
  return built.startsWith('<?xml') ? built : `<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n${built}`;
}

