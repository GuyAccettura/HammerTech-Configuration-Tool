"""
HammerTech Configuration Tool — Flask web application.

Flow:
  1. GET  /                          → login form
  2. POST /auth                      → Playwright login → /home/<job_id>
  3. GET  /home/<job_id>             → tool selector

  Inspection Checklist Upload:
  4. GET  /checklists/upload/<job>   → file upload form
  5. POST /checklists/preview/<job>  → parse Excel, show preview
  6. POST /checklists/run/<job>      → upload selected checklists → results
"""

import io
import os
import uuid
from typing import Any, Dict

from flask import Flask, render_template, request, redirect, url_for, flash

import auth as ht_auth
import uploader as ht_upload

app = Flask(__name__)
app.secret_key = os.environ.get("SECRET_KEY", "change-me-in-production")

# In-memory job store — fine for single-worker deployment on Railway.
_jobs: Dict[str, Dict[str, Any]] = {}

MAX_UPLOAD_MB = 10
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD_MB * 1024 * 1024


def _expired():
    return render_template("index.html", step="login", error="Session expired. Please log in again.")


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------

@app.get("/")
def index():
    return render_template("index.html", step="login", error=None)


@app.post("/auth")
def authenticate():
    instance = (request.form.get("instance") or "").strip()
    email = (request.form.get("email") or "").strip()
    password = (request.form.get("password") or "").strip()

    if not all([instance, email, password]):
        return render_template("index.html", step="login", error="All fields are required.")

    try:
        cookie = ht_auth.get_auth_cookie_playwright(instance, email, password)
        print(f"[DEBUG] Cookie names: {[p.split('=')[0] for p in cookie.split('; ')]}")
    except Exception as exc:
        return render_template(
            "index.html", step="login",
            error=f"Login failed for '{instance}': {exc}"
        )

    job_id = str(uuid.uuid4())
    _jobs[job_id] = {
        "instance": instance,
        "cookie": cookie,
        "email": email,
        "password": password,
    }
    return redirect(url_for("home", job_id=job_id))


# ---------------------------------------------------------------------------
# Tool selector
# ---------------------------------------------------------------------------

@app.get("/home/<job_id>")
def home(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return _expired()
    return render_template(
        "index.html", step="home",
        job_id=job_id,
        instance=job["instance"],
        error=request.args.get("error"),
    )


# ---------------------------------------------------------------------------
# Inspection Checklist Upload — file upload form
# ---------------------------------------------------------------------------

@app.get("/checklists/upload/<job_id>")
def checklist_upload_form(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return _expired()
    return render_template(
        "index.html", step="checklist_upload",
        job_id=job_id,
        instance=job["instance"],
    )


# ---------------------------------------------------------------------------
# Inspection Checklist Upload — parse + preview
# ---------------------------------------------------------------------------

@app.post("/checklists/preview/<job_id>")
def checklist_preview(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return _expired()

    file = request.files.get("excel_file")
    if not file or file.filename == "":
        return render_template(
            "index.html", step="checklist_upload",
            job_id=job_id,
            instance=job["instance"],
            error="Please select an Excel file to upload.",
        )

    sheet_raw = (request.form.get("sheet_name") or "").strip()
    sheet = int(sheet_raw) if sheet_raw.isdigit() else (sheet_raw or 0)

    try:
        file_bytes = file.read()
        df = ht_upload.parse_excel(io.BytesIO(file_bytes), sheet_name=sheet)
    except Exception as exc:
        return render_template(
            "index.html", step="checklist_upload",
            job_id=job_id,
            instance=job["instance"],
            error=f"Could not read Excel file: {exc}",
        )

    previews = ht_upload.get_preview(df)
    if not previews:
        return render_template(
            "index.html", step="checklist_upload",
            job_id=job_id,
            instance=job["instance"],
            error="No valid checklist rows found in the file.",
        )

    # Stash parsed data so the run step doesn't need to re-parse
    job["pending_df"] = df
    job["pending_previews"] = previews

    return render_template(
        "index.html", step="checklist_preview",
        job_id=job_id,
        instance=job["instance"],
        previews=previews,
    )


# ---------------------------------------------------------------------------
# Inspection Checklist Upload — run upload
# ---------------------------------------------------------------------------

@app.post("/checklists/run/<job_id>")
def checklist_run(job_id: str):
    job = _jobs.get(job_id)
    if not job:
        return _expired()

    df = job.get("pending_df")
    if df is None:
        return redirect(url_for("checklist_upload_form", job_id=job_id))

    selected_ids = request.form.getlist("checklist_ids")
    if not selected_ids:
        return render_template(
            "index.html", step="checklist_preview",
            job_id=job_id,
            instance=job["instance"],
            previews=job.get("pending_previews", []),
            error="Select at least one checklist to upload.",
        )

    session = ht_auth.build_session(job["cookie"])
    results = ht_upload.upload_checklists(
        session=session,
        instance=job["instance"],
        df=df,
        selected_ids=selected_ids,
    )

    # Clear pending data after run
    job.pop("pending_df", None)
    job.pop("pending_previews", None)

    return render_template(
        "index.html", step="results",
        job_id=job_id,
        instance=job["instance"],
        results=results,
        result_type="checklists",
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
