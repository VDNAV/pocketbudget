"""
PocketBudget — move your data from the old laptop app to the new offline app.

Run this ONCE on your laptop, inside your old app folder (the one with budget.db):

    python export_for_v4.py

It only READS budget.db and static/uploads (nothing is changed or deleted) and writes
one file: pocketbudget-import.json. Open the new app → Sync & settings →
"Restore / import backup" and choose that file.

Every record gets a fixed ID based on its old number, so importing the same file on
your phone AND your laptop never creates duplicates.
"""
import base64
import io
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.cwd()
DB = HERE / "budget.db"
UPLOADS = HERE / "static" / "uploads"
OUT = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else HERE / "pocketbudget-import.json"
STAMP = "2026-01-01T00:00:00.000Z"  # fixed, older than any edit you make in the new app


def shrink(path):
    """Return (bytes, mime). Photos are resized to 1600px JPEG like the new app does; falls back to the original file."""
    raw = path.read_bytes()
    try:
        from PIL import Image, ImageOps
        img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
        img.thumbnail((1600, 1600))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=82, optimize=True)
        return buf.getvalue(), "image/jpeg"
    except Exception:
        ext = path.suffix.lower().lstrip(".")
        return raw, {"png": "image/png", "webp": "image/webp"}.get(ext, "image/jpeg")


def main():
    if not DB.exists():
        sys.exit(f"Could not find budget.db in {HERE}. Run this inside your old PocketBudget folder.")
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)  # read-only
    con.row_factory = sqlite3.Row
    cols = lambda t: {r[1] for r in con.execute(f"PRAGMA table_info({t})")}
    ecols = cols("expenses")
    get = lambda row, k, d=None: row[k] if k in row.keys() else d

    items = {}
    for r in con.execute("SELECT * FROM expense_items ORDER BY id"):
        items.setdefault(r["expense_id"], []).append({"name": r["item_name"], "total": float(r["line_total"])})
    receipts = {}
    try:
        for r in con.execute("SELECT * FROM expense_receipts ORDER BY id"):
            receipts.setdefault(r["expense_id"], []).append(r)
    except sqlite3.OperationalError:
        pass

    blobs, missing = [], []
    expenses = []
    for e in con.execute("SELECT * FROM expenses ORDER BY id"):
        rec_list = []
        files = receipts.get(e["id"], [])
        if not files and get(e, "receipt_filename"):
            files = [{"id": f"x{e['id']}", "filename": e["receipt_filename"], "kind": "receipt"}]
        for r in files:
            fname = r["filename"]
            path = UPLOADS / fname
            if not path.exists():
                missing.append(fname)
                continue
            rid = f"legacy-rcpt-{r['id']}"
            if not any(b["id"] == rid for b in blobs):
                data, mime = shrink(path)
                blobs.append({"id": rid, "type": mime, "data": base64.b64encode(data).decode()})
            rec_list.append({"id": rid, "kind": r["kind"], "name": fname})
        expenses.append({
            "id": f"legacy-exp-{e['id']}", "legacy_id": e["id"], "ord": e["id"],
            "spent_on": e["spent_on"], "merchant": e["merchant"] or "", "merchant_key": get(e, "merchant_key") or "",
            "description": e["description"], "amount": float(e["amount"]), "category": e["category"],
            "subcategory": e["subcategory"], "payment_method": e["payment_method"], "notes": e["notes"] or "",
            "grouped_receipt": int(e["grouped_receipt"] or 0), "source": e["source"],
            "review_status": get(e, "review_status") or "ok", "confidence": get(e, "confidence"),
            "journey": get(e, "journey") or "", "receipt_type": get(e, "receipt_type"),
            "items": items.get(e["id"], []), "receipts": rec_list, "created_at": e["created_at"],
            "updated_at": STAMP, "deleted": 0,
        })

    incomes = [{
        "id": f"legacy-inc-{r['id']}", "received_on": r["received_on"], "description": r["description"],
        "amount": float(r["amount"]), "account": r["account"] or "", "notes": r["notes"] or "",
        "created_at": r["created_at"], "updated_at": STAMP, "deleted": 0,
    } for r in con.execute("SELECT * FROM incomes ORDER BY id")]

    budgets = [{
        "id": f"{r['month']}|{r['category']}", "month": r["month"], "category": r["category"],
        "amount": float(r["amount"]), "updated_at": STAMP, "deleted": 0,
    } for r in con.execute("SELECT * FROM budgets ORDER BY id")]

    rules = [{
        "id": r["merchant_key"], "merchant_key": r["merchant_key"], "display_name": r["display_name"],
        "category": r["category"], "subcategory": r["subcategory"], "preferred_payment": r["preferred_payment"],
        "updated_at": STAMP, "deleted": 0,
    } for r in con.execute("SELECT * FROM merchant_rules ORDER BY id")]
    con.close()

    payload = {
        "format": "pocketbudget-backup", "version": 1, "source": "old laptop app (budget.db)",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "records": {"expense": expenses, "income": incomes, "budget": budgets, "rule": rules},
        "blobs": blobs,
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    total = sum(x["amount"] for x in expenses)
    print(f"Done: {OUT}")
    print(f"  {len(expenses)} expenses (Rs {total:,.2f}), {len(incomes)} income, {len(budgets)} budgets, "
          f"{len(rules)} merchant rules, {len(blobs)} photos")
    if missing:
        print(f"  Note: {len(missing)} photo file(s) were listed but not found in static/uploads and were skipped.")


if __name__ == "__main__":
    main()
