# HammerTech Configuration Tool

Internal CLI for configuring HammerTech tenants through the public API and, where needed, authenticated UI endpoints discovered from the HammerTech app.

The first implemented workflow is user configuration from a spreadsheet. It authenticates directly against HammerTech's regional auth API, stores no passwords, and defaults spreadsheet imports to a dry run.

## Install

```powershell
npm install
```

Optional, for local command linking:

```powershell
npm link
```

Without linking, run commands with:

```powershell
node ./src/cli.js --help
```

## Local UI

Start the local web UI:

```powershell
npm run dev
```

Then open:

```text
http://127.0.0.1:8787
```

Use `PORT` to choose another port:

```powershell
$env:PORT="8790"
npm run dev
```

## Authentication

Public API bearer tokens are retrieved directly from HammerTech:

| Region | Auth endpoint |
| --- | --- |
| `us` | `https://us-auth.hammertechonline.com/api/login/generatetoken` |
| `au` | `https://au-auth.hammertechonline.com/api/login/generatetoken` |
| `eu` | `https://eu-auth.hammertechonline.com/api/login/generatetoken` |

You can pass credentials with environment variables:

```powershell
$env:HAMMERTECH_REGION="us"
$env:HAMMERTECH_TENANT="tenant-name"
$env:HAMMERTECH_EMAIL="employee@example.com"
$env:HAMMERTECH_PASSWORD="..."
```

Then save a local token session:

```powershell
node ./src/cli.js auth token --save-session
```

The session file is written to `.hammertech/session.json` by default and is ignored by git. Passwords are never stored.

## Spreadsheet User Import

Start from [docs/users-template.csv](docs/users-template.csv).

Required columns for create rows:

| Column | Notes |
| --- | --- |
| `action` | `create`, `update`, `delete`, `get`, or `upsert`. Defaults to `create`. |
| `email` | Required for create. Used to resolve existing users when `--match-by-email` is enabled. |
| `name` | Required for create. |
| `title` | Required for create. |
| `roleNames` | Comma, semicolon, newline, or JSON array. Valid public API examples are `admin`, `regionadmin`, `safetymanager`. |

Optional API columns include `mobile`, `internalIdentifier`, `userProjectIds`, `regionAdminRegionIds`, `functionIds`, permission set IDs, future project flags, notification fields, confidential data fields, site diary fields, and project admin fields. Use HammerTech UUIDs for ID arrays.

Supported import file types are `.csv`, `.xlsx`, and `.xlsm`.

Dry run:

```powershell
node ./src/cli.js users import --file .\docs\users-template.csv --match-by-email
```

Apply changes:

```powershell
node ./src/cli.js users import --file .\users.xlsx --sheet Users --match-by-email --apply
```

By default, execution stops at the first failed row. Add `--continue-on-error` when batch imports should keep going.

## Direct User Commands

```powershell
node ./src/cli.js users list --include-not-assigned --output users.json
node ./src/cli.js users get --id <user-uuid>
node ./src/cli.js users create --json '{"email":"a@example.com","name":"A User","title":"Manager","roleNames":["safetymanager"]}'
node ./src/cli.js users update --id <user-uuid> --json '{"title":"Director"}'
node ./src/cli.js users delete --id <user-uuid>
```

## Hidden UI APIs

The tool intentionally does not use Playwright. For UI endpoints, use HTTP session cookies captured from direct login endpoints or supplied by an existing HammerTech-authenticated flow.

Generic cookie capture:

```powershell
node ./src/cli.js auth cookie-login `
  --url "https://tenant.hammertechonline.com/path/to/login/api" `
  --body-template '{"email":"{{email}}","password":"{{password}}","tenant":"{{tenant}}"}' `
  --save-session
```

Then call a discovered hidden endpoint:

```powershell
node ./src/cli.js request POST "https://tenant.hammertechonline.com/hidden/api/path" --body-json '{"example":true}'
```

Once a hidden endpoint is verified, wrap it in a typed command instead of keeping it as a raw request.
