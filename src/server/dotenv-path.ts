import path from 'path';

/** Path to the project `.env` file (used by `/api/diagnose`). */
export function resolveProjectDotenvPath(cwd: string = process.cwd()): string {
  return path.join(cwd, '.env');
}
