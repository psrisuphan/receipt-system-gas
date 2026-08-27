# Receipt System → Google Apps Script + Sheets

Standalone Web App. Sheets = DB, Drive folder = payment evidence, GAS = backend.

## Deploy in 5 min

1. **Create Sheet**: create a new Google Sheet (blank). Copy its ID from URL `https://docs.google.com/spreadsheets/d/<ID>/edit`.
2. **Create GAS**: https://script.google.com → New Project → paste all files from `gas/` (Code.gs, Business.gs, Index.html, appsscript.json).
3. **Set Spreadsheet ID**: Project Settings → Script Properties → add `SPREADSHEET_ID` = your sheet ID. Or run as **bound script** (Extensions → Apps Script inside the Sheet) and leave property empty - it will use `getActiveSpreadsheet()`.
4. **Set Drive folder** (optional): Script Properties → `DRIVE_FOLDER_ID` = folder ID for payment evidence. If empty, one is auto-created.
5. `Run` → `setup` → authorize → check Sheet now has 8 tabs with headers + `_config`.
6. **Allowlist**: open `_config` sheet, add your Google email to `admin_allowlist` (one per row). First run auto-adds the executor as admin.
7. Deploy → `Deploy → New deployment → Web app` → Execute as **Me**, Who has access: **Anyone with Google account** (or your domain) → Deploy. Open URL.

## Sheets schema (auto-created)

| Tab | Purpose | Key columns |
|---|---|---|
| `customers` | customers | id, customer_code, name, line_id, x_account, notes, archived_at, created_at, updated_at, created_by |
| `game_categories` | categories | id, name, archived_at, created_at, updated_at |
| `services` | services | id, category_id, name, description, default_price, archived_at |
| `purchases` | purchases | id, receipt_year, receipt_sequence, receipt_number, customer_id, purchase_at, status, subtotal, discount_rate, discount_amount, total_amount, points_used, points_earned, note, created_by, cancelled_at, cancellation_reason, created_at, updated_at |
| `purchase_items` | snapshot lines | id, purchase_id, service_id, category_name, service_name, service_description, sort_order, quantity, unit_price, line_total |
| `point_ledger` | immutable ledger | id, customer_id, purchase_id, entry_type, points_delta, reason, created_by, created_at |
| `payment_evidence` | Drive file meta | id, purchase_id, file_id, mime_type, byte_size, original_filename, uploaded_by, uploaded_at |
| `audit_logs` | immutable | id, actor_email, actor_name, event_type, entity_type, entity_id, summary, before_data, after_data, metadata, created_at |
| `_config` | kv + allowlist | key/value rows + special range for admin_allowlist + store_settings |

## What changed vs Next.js+Supabase

- Auth: `Session.getActiveUser().getEmail()` checked against `_config!allowlist`. No OAuth redirect needed - GAS Web App handles Google identity.
- DB: RLS → `requireAdmin_()` guard on every mutating function. Triggers/constraints → JS validation in `Business.gs`.
- Receipt counter: Postgres sequence → `PropertiesService + LockService` (global lock, safe to ~1 write/sec; ponytail: per-year lock if throughput matters).
- Storage: Supabase private bucket → Drive folder (private, view via `DriveApp.getFileById`).
- Timestamps: `Asia/Bangkok` via `Utilities.formatDate(..., 'Asia/Bangkok', ...)`; purchase_at stored ISO with +07:00.
- Receipt PDF/PNG: client-side `window.print()` + `jsPDF` CDN (same as before, no server render).

## Limits to know

- Sheets = ~10M cells, fine for single-store. Dashboard queries scan rows in memory (no SQL aggregation).
- `LockService` global lock caps concurrent purchases; fine for admin-only low volume.
- No RLS indexes - `getAll_()` caches per request.

Delete `gas/` after deploy if you want repo clean - it was just scaffolding.
