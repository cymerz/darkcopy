// lib/crypto.ts
// Client-side AES-GCM encryption/decryption using Web Crypto API.

/**
 * Generate a random 256-bit AES-GCM key and return it as a base64url string.
 */
export async function generateEncryptionKey(): Promise<string> {
  const key = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const rawKey = await window.crypto.subtle.exportKey('raw', key);
  return arrayBufferToBase64Url(rawKey);
}

/**
 * Encrypt plaintext using a base64url encoded key.
 * Returns a string formatted as "ivHex:ciphertextHex".
 */
export async function encryptText(plaintext: string, keyBase64Url: string): Promise<string> {
  const rawKey = base64UrlToArrayBuffer(keyBase64Url);
  const key = await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['encrypt']
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    encoded
  );

  const ivHex = arrayToHex(iv);
  const ciphertextHex = arrayToHex(new Uint8Array(ciphertext));

  return `${ivHex}:${ciphertextHex}`;
}

/**
 * Decrypt a "ivHex:ciphertextHex" string using a base64url encoded key.
 */
export async function decryptText(encryptedPayload: string, keyBase64Url: string): Promise<string> {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid encrypted payload format');
  }

  const [ivHex, ciphertextHex] = parts;
  const iv = hexToArray(ivHex);
  const ciphertext = hexToArray(ciphertextHex);

  const rawKey = base64UrlToArrayBuffer(keyBase64Url);
  const key = await window.crypto.subtle.importKey(
    'raw',
    rawKey,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );

  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as any },
    key,
    ciphertext as any
  );

  return new TextDecoder().decode(decrypted);
}

// Helper functions for conversions

function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToArray(hex: string): Uint8Array {
  const len = hex.length;
  const arr = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return arr;
}
