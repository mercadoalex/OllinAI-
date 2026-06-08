#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# OllinAI — DynamoDB Backup & Restore
#
# Exports all DynamoDB table data to JSON files before terraform destroy.
# Restores data from backup files after terraform apply.
#
# Usage:
#   bash scripts/dynamodb-backup.sh backup    # Before terraform destroy
#   bash scripts/dynamodb-backup.sh restore   # After terraform apply
#
# Backup files are stored in: .dynamodb-backups/
# ─────────────────────────────────────────────────────────────────────────────

set -e

REGION="${AWS_REGION:-us-east-2}"
BACKUP_DIR=".dynamodb-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Tables to backup
TABLES=(
  "ollinai-events"
  "ollinai-incidents"
  "ollinai-metrics"
  "ollinai-config"
  "ollinai-audit"
  "ollinai-attestations"
  "ollinai-ml"
)

# ─── Backup ─────────────────────────────────────────────────────────────────────

backup() {
  echo "📦 Backing up DynamoDB tables..."
  echo "   Region: ${REGION}"
  echo "   Backup dir: ${BACKUP_DIR}/${TIMESTAMP}/"
  echo ""

  mkdir -p "${BACKUP_DIR}/${TIMESTAMP}"

  for table in "${TABLES[@]}"; do
    echo -n "  → ${table}..."

    # Check if table exists
    if ! aws dynamodb describe-table --table-name "$table" --region "$REGION" > /dev/null 2>&1; then
      echo " ⚠️  not found, skipping"
      continue
    fi

    # Scan and export all items
    ITEMS=$(aws dynamodb scan \
      --table-name "$table" \
      --region "$REGION" \
      --output json 2>/dev/null)

    COUNT=$(echo "$ITEMS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Count',0))" 2>/dev/null || echo "0")

    echo "$ITEMS" > "${BACKUP_DIR}/${TIMESTAMP}/${table}.json"
    echo " ✅ ${COUNT} items"
  done

  # Save a symlink to latest backup
  rm -f "${BACKUP_DIR}/latest"
  ln -s "${TIMESTAMP}" "${BACKUP_DIR}/latest"

  echo ""
  echo "✅ Backup complete: ${BACKUP_DIR}/${TIMESTAMP}/"
  echo "   Symlink: ${BACKUP_DIR}/latest → ${TIMESTAMP}"
  echo ""
  echo "   You can now safely run: cd infra/terraform && terraform destroy"
}

# ─── Restore ─────────────────────────────────────────────────────────────────────

restore() {
  # Determine which backup to restore
  RESTORE_DIR="${BACKUP_DIR}/latest"

  if [ ! -d "$RESTORE_DIR" ] && [ ! -L "$RESTORE_DIR" ]; then
    echo "❌ No backup found at ${RESTORE_DIR}"
    echo ""
    echo "   Available backups:"
    ls -1 "${BACKUP_DIR}/" 2>/dev/null | grep -v latest || echo "   (none)"
    echo ""
    read -p "   Continue without restoring data? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ]; then
      exit 1
    fi
    return
  fi

  # Resolve symlink
  ACTUAL_DIR=$(readlink -f "$RESTORE_DIR" 2>/dev/null || readlink "$RESTORE_DIR")
  echo "📥 Restoring DynamoDB data from backup..."
  echo "   Region: ${REGION}"
  echo "   Source: ${ACTUAL_DIR}/"
  echo ""

  for table in "${TABLES[@]}"; do
    BACKUP_FILE="${RESTORE_DIR}/${table}.json"

    if [ ! -f "$BACKUP_FILE" ]; then
      echo "  → ${table}... ⚠️  no backup file, skipping"
      continue
    fi

    # Check if table exists
    if ! aws dynamodb describe-table --table-name "$table" --region "$REGION" > /dev/null 2>&1; then
      echo "  → ${table}... ❌ table doesn't exist (run terraform apply first)"
      continue
    fi

    # Count items in backup
    COUNT=$(python3 -c "
import json, sys
with open('${BACKUP_FILE}') as f:
    data = json.load(f)
    items = data.get('Items', [])
    print(len(items))
" 2>/dev/null || echo "0")

    if [ "$COUNT" = "0" ]; then
      echo "  → ${table}... ⚠️  empty backup, skipping"
      continue
    fi

    echo -n "  → ${table} (${COUNT} items)..."

    # Restore items using batch-write-item (25 items at a time)
    python3 -c "
import json, sys, subprocess

with open('${BACKUP_FILE}') as f:
    data = json.load(f)

items = data.get('Items', [])
batch_size = 25
written = 0

for i in range(0, len(items), batch_size):
    batch = items[i:i+batch_size]
    request_items = {
        '${table}': [{'PutRequest': {'Item': item}} for item in batch]
    }
    
    payload = json.dumps({'RequestItems': request_items})
    
    result = subprocess.run(
        ['aws', 'dynamodb', 'batch-write-item', '--request-items', payload, '--region', '${REGION}'],
        capture_output=True, text=True
    )
    
    if result.returncode != 0:
        print(f' ❌ Error at batch {i}: {result.stderr[:100]}', file=sys.stderr)
        sys.exit(1)
    
    written += len(batch)

print(f' ✅ {written} items restored')
" 2>&1

  done

  echo ""
  echo "✅ Restore complete!"
}

# ─── Main ────────────────────────────────────────────────────────────────────────

case "${1}" in
  backup)
    backup
    ;;
  restore)
    restore
    ;;
  *)
    echo "Usage: $0 {backup|restore}"
    echo ""
    echo "  backup   — Export all DynamoDB tables to JSON (run before terraform destroy)"
    echo "  restore  — Import JSON backup into DynamoDB (run after terraform apply)"
    exit 1
    ;;
esac
