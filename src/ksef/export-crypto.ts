/**
 * Crypto utilities for KSeF batch export decryption.
 *
 * Flow:
 *  1. Generate random AES-256 key + 16-byte IV locally.
 *  2. RSA-OAEP-SHA256 encrypt the AES key with KSeF's SymmetricKeyEncryption
 *     public certificate → send to KSeF as encryptedSymmetricKey.
 *  3. KSeF encrypts the export ZIP with our AES key + IV.
 *  4. Download the encrypted ZIP and decrypt with AES-256-CBC.
 */

import { randomBytes, publicEncrypt, createDecipheriv, constants } from 'node:crypto';
import type { ExportEncryptionInfo, ExportKeyMaterial } from './types.js';

/**
 * Generate a fresh AES-256 key + 16-byte IV for a single export operation.
 */
export function generateExportKeyMaterial(): ExportKeyMaterial {
  return {
    aesKey: randomBytes(32),
    iv: randomBytes(16),
  };
}

/**
 * Prepare the EncryptionInfo payload to send to KSeF.
 * The AES key is RSA-OAEP-SHA256 encrypted with the KSeF SymmetricKeyEncryption cert.
 * The publicKeyId (from the cert) must be included so KSeF knows which key was used.
 */
export function buildExportEncryptionInfo(
  keyMaterial: ExportKeyMaterial,
  symmetricKeyEncryptionPublicKeyPem: string,
  publicKeyId: string
): ExportEncryptionInfo {
  const encryptedSymmetricKey = publicEncrypt(
    {
      key: symmetricKeyEncryptionPublicKeyPem,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    },
    keyMaterial.aesKey
  ).toString('base64');

  return {
    encryptedSymmetricKey,
    initializationVector: keyMaterial.iv.toString('base64'),
    publicKeyId,
  };
}

/**
 * Decrypt an AES-256-CBC encrypted ZIP buffer returned by KSeF.
 * Returns the raw (plaintext) ZIP bytes.
 */
export function decryptExportZip(
  encryptedData: Buffer,
  keyMaterial: ExportKeyMaterial
): Buffer {
  const decipher = createDecipheriv('aes-256-cbc', keyMaterial.aesKey, keyMaterial.iv);
  return Buffer.concat([decipher.update(encryptedData), decipher.final()]);
}
