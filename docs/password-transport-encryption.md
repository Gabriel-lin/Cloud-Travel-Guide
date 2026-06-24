# Password Transport Encryption (RSA-OAEP + AES-GCM)

This document describes how Cloud Travel Guide protects local username/password credentials in transit between clients and the backend API.

## Goals

- Never send plaintext passwords in HTTP request bodies for login or registration.
- Keep compatibility with existing bcrypt password storage on the server.
- Prevent trivial replay of captured login/register payloads.
- Support web, Electron, and future clients through a single API contract.
- Require explicit RSA key configuration in production.

## High-Level Flow

```mermaid
sequenceDiagram
  participant Browser
  participant API

  Browser->>API: GET /auth/password-key
  API-->>Browser: RSA public key + key_id

  Note over Browser: Generate random AES key<br/>Encrypt password payload with AES-GCM<br/>Wrap AES key with RSA-OAEP
  Browser->>API: POST /login or /register<br/>{ username, password_envelope }
  API->>API: RSA decrypt → AES decrypt → validate nonce/expiry
  API->>API: bcrypt verify or store
```

## Why Hybrid Encryption

RSA alone is unsuitable for encrypting an entire password payload at 2048-bit key size due to size limits. The implementation therefore uses a standard hybrid pattern:

1. **AES-256-GCM** encrypts the inner JSON payload (password + metadata).
2. **RSA-OAEP (SHA-256)** encrypts the ephemeral AES key only.

This matches common production practice: asymmetric crypto for key exchange, symmetric crypto for bulk data.

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/auth/password-key` | Fetch RSA public key material |
| `POST` | `/api/v1/auth/login` | Login with encrypted credential |
| `POST` | `/api/v1/auth/register` | Register with encrypted credential |

Plaintext password fields are **not** accepted on `/login` or `/register`.

### `GET /api/v1/auth/password-key`

Response example:

```json
{
  "key_id": "a1b2c3d4e5f67890",
  "public_key": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
  "algorithm": "RSA-OAEP-256",
  "cipher_suite": "AES-GCM"
}
```

- `key_id` is the first 16 hex chars of `SHA-256(SPKI DER)` for the public key.
- Clients should cache the key briefly (frontend default: 5 minutes).

### `POST /api/v1/auth/login`

Request body:

```json
{
  "username": "traveler",
  "password_envelope": {
    "key_id": "a1b2c3d4e5f67890",
    "wrapped_key": "<base64>",
    "iv": "<base64>",
    "ciphertext": "<base64>"
  }
}
```

Response: standard JWT `TokenResponse`.

### `POST /api/v1/auth/register`

Same envelope shape as login. After decryption, the server applies password policy validation, then stores a bcrypt hash.

## Envelope Structure

| Field | Description |
|-------|-------------|
| `key_id` | Public key fingerprint; must match server key |
| `wrapped_key` | Base64 RSA-OAEP ciphertext of the raw 256-bit AES key |
| `iv` | Base64 12-byte AES-GCM nonce |
| `ciphertext` | Base64 AES-GCM output (ciphertext + auth tag) |

## Inner Payload (before AES encryption)

The AES layer protects a compact JSON object:

```json
{
  "p": "<plaintext password>",
  "n": "<uuid nonce>",
  "e": 1719234567
}
```

| Field | Meaning |
|-------|---------|
| `p` | Password value |
| `n` | One-time nonce (UUID) |
| `e` | Unix expiry timestamp (seconds) |

Default TTL: **60 seconds** (`AUTH_PASSWORD_ENVELOPE_TTL_SECONDS`).

## Server-Side Decryption Steps

1. Verify `password_envelope.key_id` matches the configured RSA key.
2. RSA-OAEP decrypt `wrapped_key` → AES key.
3. AES-GCM decrypt `ciphertext` with `iv`.
4. Parse JSON payload; reject if malformed.
5. Reject if current time > `e`.
6. Insert `n` into `password_cipher_nonces`; reject if already present (replay protection).
7. Return decrypted password to auth service:
   - **Login** → bcrypt verify
   - **Register** → password policy check → bcrypt hash → persist

## Security Properties

| Property | Mechanism |
|----------|-----------|
| No plaintext on wire (app layer) | Hybrid envelope only |
| Replay resistance | One-time nonce table |
| Time-bound credentials | Envelope expiry |
| Password storage | bcrypt after decryption |
| Transport baseline | **HTTPS/TLS required in production** |

### What this does **not** replace

- TLS remains mandatory. This scheme protects against plaintext exposure in proxies, logs, and browser devtools at the application layer; it does not remove the need for HTTPS.
- This is not a zero-knowledge or SRP protocol. The server ultimately receives the password to verify against bcrypt.

## Configuration

### Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` | Production: yes | RSA private key (PKCS#8 PEM) |
| `AUTH_PASSWORD_ENVELOPE_TTL_SECONDS` | No (default `60`) | Envelope lifetime in seconds |
| `ENVIRONMENT` | — | `production` enforces RSA key presence |

### `.env` format

PEM can be stored as a single escaped line:

```env
AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----"
```

Development: if unset, the backend auto-generates an ephemeral RSA key at startup (not suitable for multi-instance production).

### Generate RSA key

From `backend/`:

```bash
# Output a ready-to-paste .env line
uv run python scripts/generate_password_rsa_key.py

# Output escaped PEM value only (for CI / GitHub Secrets)
uv run python scripts/generate_password_rsa_key.py --format value

# Output raw PEM file
uv run python scripts/generate_password_rsa_key.py --format pem > password_rsa.pem
```

### GitHub Actions example

```yaml
- name: Load password transport RSA key
  working-directory: backend
  env:
    AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM: ${{ secrets.AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM }}
  run: echo "Key configured"
```

For production, store the key in **GitHub Secrets** (or your secret manager) and inject it at deploy time. Do not regenerate per deployment unless you intentionally rotate keys.

## Database

Replay protection uses table `password_cipher_nonces`:

```text
password_cipher_nonces
  nonce       TEXT PRIMARY KEY
  expires_at  TIMESTAMPTZ NOT NULL
  created_at  TIMESTAMPTZ NOT NULL
```

Migration: `backend/alembic/versions/20260624_0003_password_cipher_nonces.py`

Run:

```bash
cd backend
uv run alembic upgrade head
```

## Client Implementation

### Frontend (web / Electron renderer)

| File | Role |
|------|------|
| `frontend/src/lib/auth/password-cipher.ts` | Web Crypto seal logic |
| `frontend/src/service/auth/auth.service.ts` | Fetches key, seals password, calls API |

Flow inside `authService.login()` / `authService.register()`:

1. `GET /api/v1/auth/password-key` (cached up to 5 min)
2. Build inner JSON `{ p, n, e }`
3. AES-GCM encrypt payload
4. RSA-OAEP encrypt AES key
5. `POST` envelope with username

UI components pass plaintext only to the service layer; encryption happens before the HTTP request.

### Backend

| File | Role |
|------|------|
| `backend/app/core/password_transport.py` | Seal/open primitives |
| `backend/app/core/password_rsa_key.py` | Key generation + PEM normalization |
| `backend/app/services/password_cipher_service.py` | Decrypt + nonce consumption |
| `backend/app/api/v1/auth.py` | HTTP endpoints |

## Password Policy (register only)

After decryption, registration passwords must:

- Be 6–128 characters
- Contain uppercase, lowercase, and a digit
- Use only `A–Z`, `a–z`, `0–9`

Login does not re-validate format; it only verifies bcrypt.

## Error Cases

| Condition | HTTP status | Example detail |
|-----------|-------------|----------------|
| Unknown username (login) | `404` | `User is not registered` |
| Wrong password (login) | `401` | `Incorrect password` |
| Expired envelope | `400` | `Password envelope expired` |
| Reused nonce | `400` | `Password envelope has already been used` |
| Invalid register password | `400` | Policy message |
| `key_id` mismatch | `400` | `Password envelope key mismatch` |

## Key Rotation

1. Generate a new RSA key pair.
2. Update `AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM` on all API instances.
3. Restart backend services.
4. `key_id` changes automatically; clients refresh cached public keys on next fetch.

Existing bcrypt password hashes are unaffected.

## Related Documents

- [Production Deployment And Multi-Client OAuth](./production-deployment-and-multi-client-oauth.md)
