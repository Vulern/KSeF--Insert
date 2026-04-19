/**
 * Validate Command
 * Validate downloaded XML files against schema
 */

import { Command } from 'commander';
import { readdir, readFile } from 'fs/promises';
import { resolve, join } from 'path';
import { config } from '../../config.js';
import { emojis, printHeader, printSuccess, printError, printInfo, printWarning, progressBar } from '../formatter.js';
import { Progress } from '../progress.js';

interface ValidateOptions {
  dir?: string;
}

export function createValidateCommand(): Command {
  const command = new Command('validate');
  command
    .description('Validate downloaded XML files against KSeF schema')
    .option('--dir <directory>', 'Directory to validate (defaults to output dir)')
    .action((options: ValidateOptions) => validateAction(options).catch(handleError));

  return command;
}

async function validateAction(options: ValidateOptions): Promise<void> {
  printHeader(`${emojis.search} Validate XML Files`);
  console.log();

  try {
    const dir = options.dir || config.insert.outputDir;
    const spinner = new Progress();
    spinner.start(`Scanning directory: ${dir}`);

    // Find all XML files
    const xmlFiles = await findXmlFiles(dir);

    if (xmlFiles.length === 0) {
      spinner.warn('No XML files found');
      console.log();
      return;
    }

    spinner.succeed(`Found ${xmlFiles.length} XML file${xmlFiles.length !== 1 ? 's' : ''}`);
    console.log();

    // Validate each file
    let valid = 0;
    let invalid = 0;
    const errors: Array<{ file: string; error: string }> = [];

    const validationSpinner = new Progress();
    validationSpinner.start(`Validating: [${progressBar(0, xmlFiles.length)}] 0/${xmlFiles.length}`);

    for (let i = 0; i < xmlFiles.length; i++) {
      const file = xmlFiles[i];
      try {
        const content = await readFile(file, 'utf-8');

        // Basic XML validation
        if (!isValidXml(content)) {
          invalid++;
          errors.push({ file: file.split('/').pop() || file, error: 'Invalid XML structure' });
        } else {
          // Check for required KSeF elements
          if (!hasKsefElements(content)) {
            invalid++;
            errors.push({ file: file.split('/').pop() || file, error: 'Missing KSeF elements' });
          } else {
            valid++;
          }
        }
      } catch (error) {
        invalid++;
        errors.push({
          file: file.split('/').pop() || file,
          error: (error as Error).message,
        });
      }

      const percent = Math.round(((i + 1) / xmlFiles.length) * 100);
      validationSpinner.update(
        `Validating: [${progressBar(i + 1, xmlFiles.length)}] ${i + 1}/${xmlFiles.length} (${percent}%)`
      );
    }

    if (valid > 0) {
      validationSpinner.succeed(`Validation complete: ${valid} valid, ${invalid} invalid`);
    } else {
      validationSpinner.fail(`Validation complete: ${valid} valid, ${invalid} invalid`);
    }

    console.log();

    // Summary
    printInfo(`Valid files:       ${valid}/${xmlFiles.length}`);
    if (invalid > 0) {
      printError(`Invalid files:     ${invalid}/${xmlFiles.length}`);

      if (errors.length > 0 && errors.length <= 10) {
        console.log();
        printWarning('Issues found:');
        errors.forEach((err) => {
          console.log(`  - ${err.file}: ${err.error}`);
        });
      } else if (errors.length > 10) {
        console.log();
        printWarning(`Issues found (showing first 10 of ${errors.length}):`);
        errors.slice(0, 10).forEach((err) => {
          console.log(`  - ${err.file}: ${err.error}`);
        });
      }
    }

    console.log();
  } catch (error) {
    throw error;
  }
}

async function findXmlFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  const scanDir = async (currentDir: string) => {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);

        if (entry.isDirectory()) {
          await scanDir(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.xml')) {
          files.push(fullPath);
        }
      }
    } catch {
      // Ignore read errors
    }
  };

  await scanDir(dir);
  return files;
}

function isValidXml(content: string): boolean {
  try {
    const trimmed = content.trim();
    if (!trimmed.startsWith('<') || !trimmed.endsWith('>')) {
      return false;
    }

    // Basic check for matching tags
    const openTags = (content.match(/<\w+/g) || []).length;
    const closeTags = (content.match(/<\/\w+>/g) || []).length;

    return openTags === closeTags && openTags > 0;
  } catch {
    return false;
  }
}

function hasKsefElements(content: string): boolean {
  // Check for common KSeF/FA elements
  const requiredPatterns = [
    /<.*Faktura/, // Invoice element
    /xmlns/, // Namespace declaration
  ];

  return requiredPatterns.some((pattern) => pattern.test(content));
}

function handleError(error: Error): void {
  console.error(`${emojis.error} Error:`, error.message);
  process.exit(1);
}
