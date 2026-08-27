# Receipt System — Google Apps Script + Sheets

Single-store receipt system rebuilt for GAS. See `gas/README.md` for deploy steps.

```
gas/
  Code.gs        # auth, sheets, setup, audit, drive
  Business.gs    # loyalty, receipt STORE-YYYY-000001, purchase CRUD (prefix = store_name)
  Index.html     # SPA (dashboard, create purchase, history, customers, services, receipt, audit, settings)
  appsscript.json
```

Deploy: `gas/README.md` → set `SPREADSHEET_ID` → Run `setup` → Deploy Web App.

No Next.js/Supabase — Sheets = DB, Drive folder = evidence, `Session.getActiveUser()` + allowlist = auth.
