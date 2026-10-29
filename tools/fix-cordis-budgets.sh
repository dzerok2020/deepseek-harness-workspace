#!/usr/bin/env bash
# Repair only known or/cgw budgets using web-model-budgets.yml policy.
# Preserve valid large models and unrelated configuration; back up before writing.
# Disk changes do not prove active RAM/upstream limits; restart only with approval.
set -euo pipefail
F="${DSH_HOME:-$HOME/.dsh}/profiles/web/cordis.patch.yml"
# After stopping profile writers: bash tools/fix-cordis-budgets.sh --writer-stopped
exec python3 "$(dirname "$0")/model_budgets.py" --repair "$F" "$@"
