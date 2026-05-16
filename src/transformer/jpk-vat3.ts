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
  return (nip ?? '').replace(/\D/g, '');
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
  return safeToken(value);
}

export interface JpkVat3RowBase {
  contractorNip: string;
  contractorName: string;
  contractorAddress: string;
  documentNumber: string;
  /** Numer KSeF z nazwy pliku — emitowany w JPK_V7M(3) jako element `NrKSeF` pod `Ewidencja`. */
  ksefReferenceNumber?: string;
  issueDate?: string;
  saleDate?: string;
  net23?: number;
  vat23?: number;
}

function unwrapOne(v: unknown): unknown {
  return Array.isArray(v) ? v[0] : v;
}

function getDirectChildLocal(obj: Record<string, unknown>, ln: string): unknown {
  for (const [k, v] of Object.entries(obj)) {
    if (localName(k) === ln) return v;
  }
  return undefined;
}

function pickStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    const s = String(v).trim();
    return s.length > 0 ? s : undefined;
  }
  return undefined;
}

function formatFaAdres(adres: unknown): string | undefined {
  const a = unwrapOne(adres);
  if (!a || typeof a !== 'object') return undefined;
  const o = a as Record<string, unknown>;
  const kk = pickStr(getDirectChildLocal(o, 'KodKraju'));
  const l1 = pickStr(getDirectChildLocal(o, 'AdresL1'));
  const l2 = pickStr(getDirectChildLocal(o, 'AdresL2'));
  const parts = [l1, l2, kk].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(', ') : undefined;
}

function isFakturaBlock(o: unknown): o is Record<string, unknown> {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  let hasP1 = false;
  let hasFa = false;
  for (const k of Object.keys(r)) {
    const ln = localName(k);
    if (ln === 'Podmiot1') hasP1 = true;
    if (ln === 'Fa') hasFa = true;
  }
  return hasP1 && hasFa;
}

/** Znajduje rekord faktury FA (2)/(3): ma Podmiot1 i sekcję Fa — unika brania pierwszego `NIP` z całego drzewa. */
function findFakturaRecord(root: unknown): Record<string, unknown> | undefined {
  if (root == null) return undefined;
  if (Array.isArray(root)) {
    for (const item of root) {
      const f = findFakturaRecord(item);
      if (f) return f;
    }
    return undefined;
  }
  if (typeof root !== 'object') return undefined;
  const r = root as Record<string, unknown>;

  for (const [k, v] of Object.entries(r)) {
    if (localName(k) !== 'Faktura' || v == null || typeof v !== 'object') continue;
    const inner = unwrapOne(v);
    if (!inner || typeof inner !== 'object') continue;
    const block = inner as Record<string, unknown>;
    if (isFakturaBlock(block)) return block;
    const nested = findFakturaRecord(block);
    if (nested) return nested;
  }

  if (isFakturaBlock(r)) return r;

  for (const v of Object.values(r)) {
    const f = findFakturaRecord(v);
    if (f) return f;
  }
  return undefined;
}

function extractPodmiot1Party(podmiot: unknown): { nip?: string; nazwa?: string; adres?: string } {
  const p = unwrapOne(podmiot);
  if (!p || typeof p !== 'object') return {};
  const o = p as Record<string, unknown>;
  const di = unwrapOne(getDirectChildLocal(o, 'DaneIdentyfikacyjne'));
  let nip: string | undefined;
  let nazwa: string | undefined;
  if (di && typeof di === 'object') {
    const d = di as Record<string, unknown>;
    nip = pickStr(getDirectChildLocal(d, 'NIP'));
    nazwa = pickStr(getDirectChildLocal(d, 'Nazwa'));
  }
  const adres = formatFaAdres(getDirectChildLocal(o, 'Adres'));
  return {
    nip: nip ? normalizeNip(nip) : undefined,
    nazwa,
    adres,
  };
}

function extractPodmiot2Party(podmiot: unknown): { nip?: string; nazwa?: string; adres?: string } {
  const p = unwrapOne(podmiot);
  if (!p || typeof p !== 'object') return {};
  const o = p as Record<string, unknown>;
  const di = unwrapOne(getDirectChildLocal(o, 'DaneIdentyfikacyjne'));
  let nip: string | undefined;
  let nazwa: string | undefined;
  if (di && typeof di === 'object') {
    const d = di as Record<string, unknown>;
    const nipRaw = pickStr(getDirectChildLocal(d, 'NIP'));
    if (nipRaw) nip = normalizeNip(nipRaw);
    const kodUe = pickStr(getDirectChildLocal(d, 'KodUE'));
    const nrVatUe = pickStr(getDirectChildLocal(d, 'NrVatUE'));
    if (!nip && kodUe && nrVatUe) nip = `${kodUe}${nrVatUe}`.replace(/\s+/g, '');
    const nrId = pickStr(getDirectChildLocal(d, 'NrID'));
    if (!nip && nrId) nip = normalizeNip(nrId) || nrId.trim();
    nazwa = pickStr(getDirectChildLocal(d, 'Nazwa'));
  }
  const adres = formatFaAdres(getDirectChildLocal(o, 'Adres'));
  return { nip, nazwa, adres };
}

function extractFaSectionAmountsAndMeta(faktura: Record<string, unknown>): {
  docNo?: string;
  issueDate?: string;
  saleDate?: string;
  net23?: number;
  vat23?: number;
} {
  const fa = unwrapOne(getDirectChildLocal(faktura, 'Fa'));
  if (!fa || typeof fa !== 'object') return {};
  const o = fa as Record<string, unknown>;
  const docNo =
    pickStr(getDirectChildLocal(o, 'P_2')) ?? pickStr(getDirectChildLocal(o, 'P_2A'));
  const issueDate = normalizeDate(pickStr(getDirectChildLocal(o, 'P_1')));
  let saleDate = normalizeDate(pickStr(getDirectChildLocal(o, 'P_6')));
  if (!saleDate) {
    const okres = unwrapOne(getDirectChildLocal(o, 'OkresFa'));
    if (okres && typeof okres === 'object') {
      const or = okres as Record<string, unknown>;
      saleDate =
        normalizeDate(pickStr(getDirectChildLocal(or, 'P_6_Do'))) ??
        normalizeDate(pickStr(getDirectChildLocal(or, 'P_6_Od')));
    }
  }
  const net23 = asNumber(getDirectChildLocal(o, 'P_13_1'));
  const vat23 = asNumber(getDirectChildLocal(o, 'P_14_1'));
  return { docNo, issueDate, saleDate, net23, vat23 };
}

/** Kontrahent w JPK_VAT to druga strona względem podmiotu: sprzedaż → nabywca, zakup → sprzedawca. Porównanie NIP firmy z Podmiot1/2 rozstrzyga przypisanie. */
function contractorFromFaParties(
  folderType: JpkVatFolderType,
  companyNip: string,
  seller: { nip?: string; nazwa?: string; adres?: string },
  buyer: { nip?: string; nazwa?: string; adres?: string },
  flat: { nip: string; nazwa: string; adres: string }
): { nip: string; nazwa: string; adres: string } {
  const co = normalizeNip(companyNip);
  const sn = seller.nip ? normalizeNip(seller.nip) : '';
  const bn = buyer.nip ? normalizeNip(buyer.nip) : '';

  if (co && folderType === 'sprzedaz' && sn === co) {
    return {
      nip: bn || flat.nip,
      nazwa: (buyer.nazwa ?? flat.nazwa).trim(),
      adres: (buyer.adres ?? flat.adres).trim(),
    };
  }
  if (co && folderType === 'sprzedaz' && bn === co) {
    return {
      nip: sn || flat.nip,
      nazwa: (seller.nazwa ?? flat.nazwa).trim(),
      adres: (seller.adres ?? flat.adres).trim(),
    };
  }
  if (co && folderType === 'zakup' && bn === co) {
    return {
      nip: sn || flat.nip,
      nazwa: (seller.nazwa ?? flat.nazwa).trim(),
      adres: (seller.adres ?? flat.adres).trim(),
    };
  }
  if (co && folderType === 'zakup' && sn === co) {
    return {
      nip: bn || flat.nip,
      nazwa: (buyer.nazwa ?? flat.nazwa).trim(),
      adres: (buyer.adres ?? flat.adres).trim(),
    };
  }
  return flat;
}

/**
 * Best-effort extraction from KSeF FA(2)/(3) XML to data needed for JPK_VAT(3).
 * Preferuje ścieżki FA: Podmiot1/Podmiot2 + Fa (żeby NIP/nazwa/adres dotyczyły właściwej strony).
 */
export function ksefInvoiceXmlToJpkVat3Row(params: {
  xml: string;
  folderType: JpkVatFolderType;
  companyNip: string;
  ksefReferenceNumber?: string;
  fallback?: {
    invoicingDate?: string;
    issueDate?: string;
    sellerNip?: string;
    buyerNip?: string;
  };
}): { kind: 'sprzedaz' | 'zakup'; row: JpkVat3RowBase } {
  const { xml, folderType, companyNip, fallback, ksefReferenceNumber: ksefFromParams } = params;
  if (!xml) throw new KsefValidationError('Empty invoice XML (cannot transform to JPK_VAT)');

  const obj = xmlParser.parse(xml) as Record<string, unknown>;
  const values = new Map<string, string[]>();
  collectValuesByLocalName(obj, values);

  const faktura = findFakturaRecord(obj);
  const faMeta = faktura ? extractFaSectionAmountsAndMeta(faktura) : {};
  const sellerParty = faktura ? extractPodmiot1Party(getDirectChildLocal(faktura, 'Podmiot1')) : {};
  const buyerParty = faktura ? extractPodmiot2Party(getDirectChildLocal(faktura, 'Podmiot2')) : {};

  const docNo =
    faMeta.docNo ??
    first(values, ['P_2A', 'P_2', 'NrFaktury', 'NumerFaktury', 'InvoiceNumber', 'NrFa']) ??
    first(values, ['DowodSprzedazy', 'DowodZakupu']) ??
    undefined;
  if (!docNo) throw new KsefValidationError('Could not detect invoice number for JPK_VAT row');

  const issueDate =
    faMeta.issueDate ??
    normalizeDate(first(values, ['DataWystawienia', 'IssueDate', 'P_1']) ?? fallback?.issueDate);
  const saleDate =
    faMeta.saleDate ??
    normalizeDate(first(values, ['DataSprzedazy', 'InvoicingDate', 'P_6']) ?? fallback?.invoicingDate);

  const net23 =
    faMeta.net23 ??
    asNumber(first(values, ['P_13_1', 'K_19'])) ??
    asNumber(first(values, ['Net23', 'Netto23']));
  const vat23 =
    faMeta.vat23 ??
    asNumber(first(values, ['P_14_1', 'K_20'])) ??
    asNumber(first(values, ['Vat23', 'VAT23']));

  const sellerNip =
    sellerParty.nip ??
    normalizeNip(first(values, ['NIPSprzedawcy', 'NipSprzedawcy', 'SellerNIP', 'P_4B']) ?? fallback?.sellerNip);
  const buyerNip =
    buyerParty.nip ??
    normalizeNip(first(values, ['NIPNabywcy', 'NipNabywcy', 'BuyerNIP', 'P_5B']) ?? fallback?.buyerNip);
  const sellerName =
    sellerParty.nazwa ?? first(values, ['NazwaSprzedawcy', 'PelnaNazwaSprzedawcy', 'SellerName', 'P_3C']);
  const buyerName =
    buyerParty.nazwa ?? first(values, ['NazwaNabywcy', 'PelnaNazwaNabywcy', 'BuyerName', 'P_3A']);
  const sellerAddr =
    sellerParty.adres ?? first(values, ['AdresSprzedawcy', 'SellerAddress', 'P_3D']);
  const buyerAddr =
    buyerParty.adres ?? first(values, ['AdresNabywcy', 'BuyerAddress', 'P_3B']);

  const isSales = folderType === 'sprzedaz';
  const flatContractor = {
    nip: normalizeNip(isSales ? (buyerNip || '') : (sellerNip || '')),
    nazwa: ((isSales ? buyerName : sellerName) ?? '').trim(),
    adres: ((isSales ? buyerAddr : sellerAddr) ?? '').trim(),
  };

  const resolved = contractorFromFaParties(folderType, companyNip, sellerParty, buyerParty, flatContractor);

  return {
    kind: folderType,
    row: {
      contractorNip: normalizeNip(resolved.nip),
      contractorName: resolved.nazwa.trim(),
      contractorAddress: resolved.adres.trim(),
      documentNumber: docNo.trim(),
      ksefReferenceNumber: ksefFromParams?.trim() || undefined,
      issueDate,
      saleDate,
      net23,
      vat23,
    },
  };
}

/** JPK_VAT(3) z 2017 — format rozpoznawany przez InsERT przy imporcie ewidencji (bez `NrKSeF` w XSD). */
const NS_JPK_VAT_2017 = 'http://jpk.mf.gov.pl/wzor/2017/11/13/1113/';
const NS_ETD = 'http://crd.gov.pl/xml/schematy/dziedzinowe/mf/2016/01/25/eD/DefinicjeTypy/';

/**
 * Ewidencja VAT wg schematu **JPK_VAT (3) / 2017** — ten plik importuj w InsERT (Operacje → Import z JPK_VAT i JPK_V7).
 * Numeru KSeF nie ma w XSD; numery są w pliku `KSeF_numery_*.csv` oraz w opcjonalnym `JPK_V7M_KSEF_*.xml`.
 */
export function buildInsertJpkVat2017Xml(params: {
  month: string;
  podmiotNip: string;
  podmiotPelnaNazwa?: string;
  rows: Array<{ kind: JpkVatFolderType; row: JpkVat3RowBase }>;
  systemName?: string;
}): string {
  const { month, podmiotNip, podmiotPelnaNazwa, rows, systemName } = params;

  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new KsefValidationError(`Invalid month format: ${month} (expected YYYY-MM)`);

  const monthNo = Number(m[2]);
  const from = new Date(Date.UTC(Number(m[1]), monthNo - 1, 1));
  const to = new Date(Date.UTC(Number(m[1]), monthNo, 0));
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
      '@_xmlns:etd': NS_ETD,
      '@_xmlns:tns': NS_JPK_VAT_2017,
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'tns:Naglowek': {
        'tns:KodFormularza': {
          '@_kodSystemowy': 'JPK_VAT (3)',
          '@_wersjaSchemy': '1-1',
          '#text': 'JPK_VAT',
        },
        'tns:WariantFormularza': 3,
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
  if (!built) throw new KsefValidationError('Failed to build JPK_VAT(2017) XML');
  return built.startsWith('<?xml') ? built : `<?xml version="1.0" encoding="UTF-8"?>\n${built}`;
}

/** JPK_V7M(3) — MF/CRD; pole `NrKSeF` w `Ewidencja`. Namespace `jpk.mf.gov.pl` jak w publikacjach MF. */
const NS_JPK_V7M = 'http://jpk.mf.gov.pl/wzor/2025/06/18/06181/';

function formatDataCzasJpk(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function buildJpkV7m3WithKsefXml(params: {
  month: string; // YYYY-MM
  podmiotNip: string;
  podmiotPelnaNazwa?: string;
  rows: Array<{ kind: JpkVatFolderType; row: JpkVat3RowBase }>;
  systemName?: string;
  /** Kod urzędu skarbowego — 4 cyfry (wykaz MF), wymagany w nagłówku JPK_V7M */
  taxOfficeCode: string;
}): string {
  const { month, podmiotNip, podmiotPelnaNazwa, rows, systemName, taxOfficeCode } = params;

  const kodUs = taxOfficeCode.trim();
  if (!/^\d{4}$/.test(kodUs)) {
    throw new KsefValidationError(
      'Nieprawidłowy INSERT_KOD_URZEDU — ustaw dokładnie 4 cyfry kodu urzędu skarbowego (wykaz MF), np. 1465.'
    );
  }

  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) throw new KsefValidationError(`Invalid month format: ${month} (expected YYYY-MM)`);

  const year = Number(m[1]);
  const monthNo = Number(m[2]);
  const from = new Date(Date.UTC(year, monthNo - 1, 1));
  const to = new Date(Date.UTC(year, monthNo, 0));
  const dataDo = to.toISOString().slice(0, 10);

  const salesRows = rows.filter((r) => r.kind === 'sprzedaz').map((r) => r.row);
  const buyRows = rows.filter((r) => r.kind === 'zakup').map((r) => r.row);

  let lpS = 0;
  const sprzedazWiersz = salesRows.map((r) => {
    lpS++;
    const k19 = r.net23 ?? 0;
    const k20 = r.vat23 ?? 0;
    const dw = r.issueDate ?? r.saleDate ?? dataDo;
    const ds = r.saleDate ?? r.issueDate ?? dataDo;
    const ksef = safeToken(r.ksefReferenceNumber);
    const out: Record<string, unknown> = {
      'tns:LpSprzedazy': lpS,
      'tns:NrKontrahenta': safeToken(r.contractorNip) ?? '0000000000',
      'tns:NazwaKontrahenta': safeToken(r.contractorName) ?? 'BRAK_DANYCH',
      'tns:DowodSprzedazy': safeToken(r.documentNumber) ?? `DOK_${lpS}`,
      'tns:DataWystawienia': dw,
      'tns:DataSprzedazy': ds,
      ...(ksef ? { 'tns:NrKSeF': ksef } : {}),
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
    const dz = r.saleDate ?? r.issueDate ?? dataDo;
    const dwplyw = r.issueDate ?? r.saleDate ?? dataDo;
    const ksef = safeToken(r.ksefReferenceNumber);
    const out: Record<string, unknown> = {
      'tns:LpZakupu': lpZ,
      'tns:NrDostawcy': safeToken(r.contractorNip) ?? '0000000000',
      'tns:NazwaDostawcy': safeToken(r.contractorName) ?? 'BRAK_DANYCH',
      'tns:DowodZakupu': safeToken(r.documentNumber) ?? `DOK_${lpZ}`,
      'tns:DataZakupu': dz,
      'tns:DataWplywu': dwplyw,
      ...(ksef ? { 'tns:NrKSeF': ksef } : {}),
      'tns:K_45': Number(k45.toFixed(2)),
      'tns:K_46': Number(k46.toFixed(2)),
    };
    return out;
  });

  const podatekNalezny = sprzedazWiersz.reduce((s, r) => s + Number((r['tns:K_20'] as number) ?? 0), 0);
  const podatekNaliczony = zakupWiersz.reduce((s, r) => s + Number((r['tns:K_46'] as number) ?? 0), 0);

  const pelnaNazwa = safeToken(podmiotPelnaNazwa) ?? `Podmiot_${podmiotNip}`;

  const ewidencja: Record<string, unknown> = {
    ...(sprzedazWiersz.length > 0 ? { 'tns:SprzedazWiersz': sprzedazWiersz } : {}),
    'tns:SprzedazCtrl': {
      'tns:LiczbaWierszySprzedazy': sprzedazWiersz.length,
      'tns:PodatekNalezny': Number(podatekNalezny.toFixed(2)),
    },
    ...(zakupWiersz.length > 0 ? { 'tns:ZakupWiersz': zakupWiersz } : {}),
    'tns:ZakupCtrl': {
      'tns:LiczbaWierszyZakupow': zakupWiersz.length,
      'tns:PodatekNaliczony': Number(podatekNaliczony.toFixed(2)),
    },
  };

  const doc: Record<string, unknown> = {
    '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
    'tns:JPK': {
      '@_xmlns:etd': NS_ETD,
      '@_xmlns:tns': NS_JPK_V7M,
      '@_xmlns:xsi': 'http://www.w3.org/2001/XMLSchema-instance',
      'tns:Naglowek': {
        'tns:KodFormularza': {
          '@_kodSystemowy': 'JPK_V7M (3)',
          '@_wersjaSchemy': '1-0E',
          '#text': 'JPK_VAT',
        },
        'tns:WariantFormularza': 3,
        'tns:DataWytworzeniaJPK': formatDataCzasJpk(new Date()),
        'tns:NazwaSystemu': systemName ?? 'KSeF--Insert',
        'tns:CelZlozenia': { '@_poz': 'P_7', '#text': 1 },
        'tns:KodUrzedu': kodUs,
        'tns:Rok': year,
        'tns:Miesiac': monthNo,
      },
      'tns:Podmiot1': {
        '@_rola': 'Podatnik',
        'tns:OsobaNiefizyczna': {
          'tns:NIP': podmiotNip,
          'tns:PelnaNazwa': pelnaNazwa,
        },
      },
      'tns:Ewidencja': ewidencja,
    },
  };

  const built = xmlBuilder.build(doc) as string;
  if (!built) throw new KsefValidationError('Failed to build JPK_V7M(3) XML');
  return built.startsWith('<?xml') ? built : `<?xml version="1.0" encoding="UTF-8"?>\n${built}`;
}

