/**
 * Diagnose Command
 * Runs local diagnostics and writes JSON report to logs/.
 */

import { Command } from 'commander';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { config } from '../../config.js';
import { KsefClient } from '../../ksef/client.js';
import { createAuth } from '../../ksef/auth.js';
import { InvoiceFileManager } from '../../storage/file-manager.js';
import { maskNip } from '../../utils/sanitize.js';
import { emojis } from '../formatter.js';

function getTodayIsoDate(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getLogDir(): string {
  return process.env.LOG_DIR || './logs';
}

export function createDiagnoseCommand(): Command {
  const command = new Command('diagnose');
  command.description('Run diagnostics and write JSON report to logs/').action(() => run().catch(fail));
  return command;
}

async function run(): Promise<void> {
  console.log();
  console.log(`${emojis.search} Diagnostyka KSeF Sync`);
  console.log('═══════════════════════════');

  const report: any = {
    timestamp: new Date().toISOString(),
    environment: config.ksef.baseUrl.includes('test') ? 'test' : 'production',
    outputDir: config.insert.outputDir,
    nip: config.ksef.nip ? maskNip(config.ksef.nip) : null,
    checks: {},
  };

  // .env
  const envFilePath = path.join(process.cwd(), '.env');
  const envFile = await fs
    .access(envFilePath)
    .then(() => true)
    .catch(() => false);

  report.checks.env = { status: envFile ? 'pass' : 'fail' };
  console.log(
    `${envFile ? emojis.success : emojis.error} Plik .env            ${
      envFile ? 'Znaleziono, kompletny' : 'Brak'
    }`
  );
  if (!envFile) console.log(`   💡 Utwórz plik .env na bazie .env.example`);

  // Connectivity
  let latency: number | null = null;
  let connectivityOk = false;
  try {
    const t0 = Date.now();
    await axios.get(config.ksef.baseUrl, { timeout: 5000, validateStatus: () => true });
    latency = Date.now() - t0;
    connectivityOk = true;
  } catch (e: any) {
    connectivityOk = false;
  }
  report.checks.ksefConnectivity = { status: connectivityOk ? 'pass' : 'fail', latency };
  console.log(
    `${connectivityOk ? emojis.success : emojis.error} Połączenie z KSeF    ${
      connectivityOk ? `${latency}ms (${report.environment})` : 'Brak'
    }`
  );
  if (!connectivityOk) console.log(`   💡 Sprawdź internet/DNS lub KSEF_BASE_URL`);

  // Auth
  const tokenSet = !!config.ksef.token;
  const nipSet = !!config.ksef.nip;
  let authOk = false;
  let authMsg = '';
  try {
    if (!tokenSet || !nipSet) {
      authOk = false;
      authMsg = 'Brak tokenu lub NIP';
    } else {
      const client = new KsefClient();
      const auth = createAuth(client);
      await auth.authenticate(config.ksef.nip!, config.ksef.token!);
      authOk = true;
      authMsg = 'OK';
      try {
        await client.terminateSession();
      } catch {
        // ignore
      }
    }
  } catch (e: any) {
    authOk = false;
    authMsg = e?.message || 'Błąd autentykacji';
  }
  report.checks.ksefAuth = { status: authOk ? 'pass' : 'fail', message: authMsg };
  console.log(`${authOk ? emojis.success : emojis.error} Autentykacja KSeF    ${authOk ? authMsg : authMsg}`);
  if (!authOk) console.log(`   💡 Wygeneruj nowy token na stronie KSeF`);

  // Output folder + disk space (unknown)
  let writable = false;
  try {
    await fs.mkdir(config.insert.outputDir, { recursive: true });
    await fs.access(config.insert.outputDir, fs.constants.W_OK as any);
    writable = true;
  } catch {
    writable = false;
  }
  report.checks.outputDir = { status: writable ? 'pass' : 'fail', writable };
  console.log(
    `${writable ? emojis.success : emojis.error} Folder output        ${writable ? 'OK' : 'Brak uprawnień'}`
  );
  if (!writable) console.log(`   💡 Sprawdź uprawnienia do INSERT_OUTPUT_DIR`);

  // Index file stats
  let indexOk = false;
  let indexCount = 0;
  try {
    const fm = new InvoiceFileManager({ outputDir: config.insert.outputDir });
    await fm.initialize();
    indexCount = (await fm.listSaved())?.length || 0;
    indexOk = true;
  } catch {
    indexOk = false;
  }
  report.checks.index = { status: indexOk ? 'pass' : 'fail', totalInvoices: indexCount };
  console.log(
    `${indexOk ? emojis.success : emojis.error} Plik indeksu         ${
      indexOk ? `${indexCount} faktur` : 'Błąd odczytu'
    }`
  );
  if (!indexOk) console.log(`   💡 Sprawdź czy .index.json nie jest uszkodzony`);

  // XSD schema (not bundled yet)
  report.checks.xsd = { status: 'fail', message: 'Brak FA(2).xsd w projekcie' };
  console.log(`${emojis.error} Schemat XSD          FA(2).xsd nieobecny`);
  console.log(`   💡 Dodaj FA(2).xsd do projektu (np. ./schemas/FA(2).xsd)`);

  // Write report JSON
  const logDir = getLogDir();
  await fs.mkdir(logDir, { recursive: true });
  const outPath = path.join(logDir, `diagnose-${getTodayIsoDate()}.json`);
  await fs.writeFile(outPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log();
  console.log(`Zapisano raport JSON do ${outPath}`);
  console.log();
}

function fail(err: any): void {
  console.error(`${emojis.error} Diagnose failed: ${err?.message || String(err)}`);
  process.exit(1);
}

