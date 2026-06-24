#!/usr/bin/env python3
"""Generate RSA private key for password transport (AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM).

Usage (from backend/):
  uv run python scripts/generate_password_rsa_key.py
  uv run python scripts/generate_password_rsa_key.py --format pem > password_rsa.pem
  uv run python scripts/generate_password_rsa_key.py --format value

GitHub Actions example:
  - name: Generate password transport RSA key
    working-directory: backend
    run: |
      VALUE=$(uv run python scripts/generate_password_rsa_key.py --format value)
      echo "::add-mask::$VALUE"
      echo "AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM=$VALUE" >> "$GITHUB_ENV"
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.core.password_rsa_key import (  # noqa: E402
    format_pem_for_env,
    generate_rsa_private_key_pem,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate RSA private key for AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM",
    )
    parser.add_argument(
        "--format",
        choices=("env", "pem", "value"),
        default="env",
        help="env: .env line (default); pem: raw PEM; value: escaped single-line PEM only",
    )
    args = parser.parse_args()

    pem = generate_rsa_private_key_pem()
    escaped = format_pem_for_env(pem)

    if args.format == "pem":
        sys.stdout.write(pem)
        if not pem.endswith("\n"):
            sys.stdout.write("\n")
        return

    if args.format == "value":
        print(escaped)
        return

    print(f'AUTH_PASSWORD_RSA_PRIVATE_KEY_PEM="{escaped}"')


if __name__ == "__main__":
    main()
