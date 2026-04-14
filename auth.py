"""
HammerTech Playwright authentication.

Uses the centralised auth server to log in headlessly and extract the
per-instance session cookie, then optionally fetches a dev-API bearer token
for accessing developer API endpoints.
"""

import time
import requests
from urllib.parse import quote

AUTH_BASE = "https://us-auth.hammertechonline.com"
DEV_API_BASE = "https://us-api.hammertechonline.com"


def get_auth_cookie_playwright(instance: str, email: str, password: str) -> str:
    """
    Launch a headless Chromium browser, log into HammerTech for *instance*,
    and return the HAMMERTECHAUTH1 session cookie as a 'name=value' string.

    Skips the VerifyEmail step by jumping directly to the LoginUser page
    with the email pre-supplied in the query string.
    """
    from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

    cookie_name_upper = f"HAMMERTECHAUTH1{instance.upper()}.HAMMERTECHONLINE.COM"
    login_url = (
        f"{AUTH_BASE}/Login/LoginUser"
        f"?Email={quote(email)}&Tenant={instance}"
        f"&IsChangePassword=False&ResetName=False"
        f"&IsChangepasswordFirstTime=False&Source=LoginClick"
    )
    instance_host = f"{instance}.hammertechonline.com"

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
        )
        context = browser.new_context()
        page = context.new_page()
        try:
            page.goto(login_url, wait_until="networkidle", timeout=30_000)

            try:
                page.wait_for_selector('[name="password"]:not([disabled])', timeout=10_000)
            except PWTimeout:
                raise ValueError(
                    f"Password field not found or not enabled for '{instance}'. "
                    f"Current URL: {page.url}"
                )
            page.fill('[name="password"]', password)
            page.keyboard.press("Enter")

            try:
                page.wait_for_url(f"**{instance_host}**", timeout=20_000)
            except PWTimeout:
                raise ValueError(
                    f"Never redirected to {instance_host} after login. "
                    "Check credentials and instance name."
                )

            for _ in range(20):
                all_cookies = context.cookies()
                if any(c["name"].upper() == cookie_name_upper for c in all_cookies):
                    break
                time.sleep(1)
            else:
                raise ValueError(
                    f"Auth cookie '{cookie_name_upper}' not found. "
                    f"Cookies: {[c['name'] for c in context.cookies()]}"
                )

            instance_cookies = context.cookies(urls=[f"https://{instance_host}/"])
            cookie_str = "; ".join(f"{c['name']}={c['value']}" for c in instance_cookies)
            print(f"[DEBUG] Cookie names for {instance}: {[c['name'] for c in instance_cookies]}")
            return cookie_str
        finally:
            browser.close()


def get_bearer_token(instance: str, email: str, password: str) -> str:
    """
    Obtain a short-lived JWT from the HammerTech developer auth API.
    Used when the developer API is available.
    """
    r = requests.post(
        f"{AUTH_BASE}/api/login/generatetoken",
        json={"email": email, "password": password, "tenant": instance},
        headers={"Accept": "application/json", "Content-Type": "application/json"},
        timeout=30,
    )
    r.raise_for_status()
    token = r.json().get("token")
    if not token:
        raise ValueError(
            f"No token in response for '{instance}'. "
            f"Response: {r.text[:300]}"
        )
    return token


def build_session(cookie_str: str) -> requests.Session:
    """Build a requests Session pre-loaded with the HammerTech auth cookie."""
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Accept": "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        "Cookie": cookie_str,
    })
    return s
