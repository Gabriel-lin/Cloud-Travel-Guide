export type PasswordKeyResponse = {
  key_id: string;
  public_key: string;
  algorithm: "RSA-OAEP-256";
  cipher_suite: "AES-GCM";
};

export type PasswordEnvelope = {
  key_id: string;
  wrapped_key: string;
  iv: string;
  ciphertext: string;
};

const PASSWORD_KEY_CACHE_MS = 5 * 60 * 1000;
const DEFAULT_ENVELOPE_TTL_SECONDS = 60;

let cachedPasswordKey: PasswordKeyResponse | null = null;
let cachedPasswordKeyFetchedAt = 0;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function importRsaPublicKey(pem: string): Promise<CryptoKey> {
  const pemContents = pem
    .replace("-----BEGIN PUBLIC KEY-----", "")
    .replace("-----END PUBLIC KEY-----", "")
    .replace(/\s/g, "");
  const binary = Uint8Array.from(atob(pemContents), (char) => char.charCodeAt(0));

  return crypto.subtle.importKey(
    "spki",
    binary,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

export function clearPasswordKeyCache(): void {
  cachedPasswordKey = null;
  cachedPasswordKeyFetchedAt = 0;
}

export async function fetchPasswordKey(
  fetcher: () => Promise<PasswordKeyResponse>,
): Promise<PasswordKeyResponse> {
  const now = Date.now();
  if (
    cachedPasswordKey &&
    now - cachedPasswordKeyFetchedAt < PASSWORD_KEY_CACHE_MS
  ) {
    return cachedPasswordKey;
  }

  cachedPasswordKey = await fetcher();
  cachedPasswordKeyFetchedAt = now;
  return cachedPasswordKey;
}

export async function sealPassword(
  key: PasswordKeyResponse,
  password: string,
  ttlSeconds = DEFAULT_ENVELOPE_TTL_SECONDS,
): Promise<PasswordEnvelope> {
  const payload = JSON.stringify({
    p: password,
    n: crypto.randomUUID(),
    e: Math.floor(Date.now() / 1000) + ttlSeconds,
  });

  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(payload);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    encoded,
  );

  const rsaKey = await importRsaPublicKey(key.public_key);
  const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
  const wrappedKey = await crypto.subtle.encrypt(
    { name: "RSA-OAEP" },
    rsaKey,
    rawAesKey,
  );

  return {
    key_id: key.key_id,
    wrapped_key: bytesToBase64(new Uint8Array(wrappedKey)),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
  };
}
