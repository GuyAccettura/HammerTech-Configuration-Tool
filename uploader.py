"""
HammerTech Configuration Tool — Inspection Checklist Uploader.

Reads an Excel file and PUTs each checklist (grouped by ID/name/displayName)
to the HammerTech ChecklistTypesApi endpoint using the session cookie
obtained via Playwright.

Required Excel columns:
  ID            — checklist ID (existing checklist to update, or new ID)
  name          — internal name
  displayName   — display name shown in UI
  questionText  — the question text
  yesText       — label for the Yes answer
  noText        — label for the No answer

Optional Excel columns:
  zIndex          — question sort order (sequential if omitted)
  ObservationType — default issue type ID for the question
"""

import time
from typing import Any, Dict, List, Tuple

import pandas as pd
import requests

# Column name constants
ID_COL = "ID"
NAME_COL = "name"
DISPLAYNAME_COL = "displayName"
QUESTION_COL = "questionText"
ZINDEX_COL = "zIndex"
YES_COL = "yesText"
NO_COL = "noText"
OBS_COL = "ObservationType"

# Checklist-level hardcodes (matches existing script behaviour)
SYSTEM_DEFINED_CHECKLIST_TYPE = "-200"
IS_HIDDEN_FROM_MAIN_LIST = False

REQUIRED_COLS = [ID_COL, NAME_COL, DISPLAYNAME_COL, QUESTION_COL, YES_COL, NO_COL]


# ---------------------------------------------------------------------------
# Payload builders
# ---------------------------------------------------------------------------

def _build_question(
    question_text: str,
    z_index: int,
    yes_text: str,
    no_text: str,
    obs_type: str,
) -> Dict[str, Any]:
    """Build a single checklist question payload object."""
    now_ms_str = str(time.time() * 1000)
    return {
        "questionText": question_text,
        "checklistQuestionType": "2",
        "zIndex": z_index,
        "isCompulsory": False,
        "inspectionTypeId": "",
        "yesText": yes_text,
        "noText": no_text,
        "naText": "n/a",
        "auditScoreOnYes": "",
        "auditScoreOnNo": "",
        "auditScoreOnNa": "",
        "signatureOnYes": False,
        "signatureOnNo": False,
        "signatureOnNa": False,
        "raiseIssueOnYes": False,
        "raiseIssueOnNo": True,
        "raiseIssueOnNa": False,
        "additionalDetailsRequiredForYes": True,
        "additionalDetailsRequiredForNo": True,
        "additionalDetailsRequiredForNa": False,
        "raiseObservationOnNaOption": 0,
        "raiseObservationOnNoOption": 3,
        "raiseObservationOnYesOption": 1,
        "issueCompulsoryOnYes": False,
        "issueCompulsoryOnNo": True,
        "issueCompulsoryOnNa": False,
        "issueDefaultObservationTypeOnYes": "1",
        "issueDefaultObservationTypeOnNo": "-1",
        "issueDefaultObservationTypeOnNa": "0",
        "isIssueDefaultObservationTypeOnYesLocked": False,
        "isIssueDefaultObservationTypeOnNoLocked": False,
        "isIssueDefaultObservationTypeOnNaLocked": False,
        "defaultIssueTypeId": obs_type,
        "isDefaultIssueTypeForced": False,
        "defaultIssuePriority": "",
        "questionTypeImageUploadPhotoPreviewUrl": "",
        "imageId": "",
        "created": now_ms_str,
        "localisedNames": [],
        "selectedLanguage": {
            "cultureName": "Default",
            "displayName": "Default",
            "flagName": "empty.png",
            "shortName": "Default",
            "buttonDisplayText": "Default",
            "pathToFlag": "/img/empty.png",
        },
        "inputValidationErrors": {},
        "dropdownOptions": "",
        "enableDropdownAuditScore": False,
        "dropdownAuditScores": "",
        "excludeFromChecklistCompleteCheck": False,
    }


def _build_checklist_payload(
    checklist_id: str,
    name: str,
    display_name: str,
    group: pd.DataFrame,
) -> Dict[str, Any]:
    """Build the full PUT payload for one checklist and all its questions."""
    if ZINDEX_COL in group.columns:
        group = group.sort_values(by=ZINDEX_COL, kind="stable")

    questions = []
    for i, row in enumerate(group.itertuples(index=False), start=1):
        if ZINDEX_COL in group.columns:
            z_raw = getattr(row, ZINDEX_COL)
            z = int(z_raw) if pd.notna(z_raw) and str(z_raw).strip() != "" else i
        else:
            z = i

        yes_text = str(getattr(row, YES_COL, "")).strip() or "Yes"
        no_text = str(getattr(row, NO_COL, "")).strip() or "No"

        obs_raw = str(getattr(row, OBS_COL, "")).strip() if hasattr(row, OBS_COL) else ""
        obs_type = "" if obs_raw.lower() in ("", "nan") else obs_raw

        questions.append(
            _build_question(
                question_text=str(getattr(row, QUESTION_COL)).strip(),
                z_index=z,
                yes_text=yes_text,
                no_text=no_text,
                obs_type=obs_type,
            )
        )

    return {
        "id": checklist_id,
        "name": name,
        "displayName": display_name,
        "systemDefinedChecklistType": SYSTEM_DEFINED_CHECKLIST_TYPE,
        "isHiddenFromMainList": IS_HIDDEN_FROM_MAIN_LIST,
        "checklistQuestions": questions,
    }


# ---------------------------------------------------------------------------
# Excel parsing
# ---------------------------------------------------------------------------

def parse_excel(file_obj, sheet_name=0) -> pd.DataFrame:
    """
    Read and validate an Excel file object.
    Returns a clean DataFrame ready for grouping.
    Raises ValueError if required columns are missing.
    """
    df = pd.read_excel(file_obj, sheet_name=sheet_name)

    missing = [c for c in REQUIRED_COLS if c not in df.columns]
    if missing:
        raise ValueError(
            f"Missing required columns: {missing}. "
            f"Found columns: {list(df.columns)}"
        )

    keep = REQUIRED_COLS + (
        [ZINDEX_COL] if ZINDEX_COL in df.columns else []
    ) + (
        [OBS_COL] if OBS_COL in df.columns else []
    )
    df = df[keep].copy()

    for col in [ID_COL, NAME_COL, DISPLAYNAME_COL, QUESTION_COL, YES_COL, NO_COL]:
        df[col] = df[col].astype(str).str.strip()

    # Drop rows with blank question text
    df = df[df[QUESTION_COL].ne("") & df[QUESTION_COL].ne("nan")]
    return df


def get_preview(df: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    Return a list of checklist summaries for displaying a preview
    before the user confirms the upload.
    """
    grouped = df.groupby([ID_COL, NAME_COL, DISPLAYNAME_COL], dropna=False)
    previews = []
    for (cid, name, display_name), group in grouped:
        previews.append({
            "id": str(cid).strip(),
            "name": str(name).strip(),
            "display_name": str(display_name).strip(),
            "question_count": len(group),
        })
    return previews


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

def upload_checklists(
    session: requests.Session,
    instance: str,
    df: pd.DataFrame,
    selected_ids: List[str] | None = None,
) -> List[Dict[str, Any]]:
    """
    Upload checklists from *df* to *instance*.

    If *selected_ids* is provided, only upload checklists whose ID is in that list.
    Returns a list of result dicts with keys: name, status, message, questions.
    """
    api_url = f"https://{instance}.hammertechonline.com/company/api/ChecklistTypesApi"
    grouped = df.groupby([ID_COL, NAME_COL, DISPLAYNAME_COL], dropna=False)
    results = []

    for (cid, name, display_name), group in grouped:
        cid_s = str(cid).strip()
        name_s = str(name).strip()
        display_s = str(display_name).strip()

        if selected_ids is not None and cid_s not in selected_ids:
            continue

        payload = _build_checklist_payload(cid_s, name_s, display_s, group)
        q_count = len(payload["checklistQuestions"])

        try:
            resp = session.put(api_url, json=payload, timeout=60)
        except requests.RequestException as exc:
            results.append({
                "name": name_s,
                "status": "error",
                "message": f"Request failed: {exc}",
                "questions": q_count,
            })
            continue

        if resp.ok:
            results.append({
                "name": name_s,
                "status": "success",
                "message": f"HTTP {resp.status_code}",
                "questions": q_count,
            })
        else:
            try:
                detail = resp.json()
            except Exception:
                detail = resp.text[:300]
            results.append({
                "name": name_s,
                "status": "error",
                "message": f"HTTP {resp.status_code}: {detail}",
                "questions": q_count,
            })

    return results
