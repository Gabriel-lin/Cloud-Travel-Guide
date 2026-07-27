# Windows helper — prefer the cross-platform Python CLI:
#   python scripts/stack.py up
#   python scripts/stack.py down

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
$env:COMPOSE_MENU = "0"

if ($args.Count -eq 0) {
    python scripts/stack.py up
} else {
    python scripts/stack.py @args
}
