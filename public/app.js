const state = {
  session: null,
  users: [],
  selectedUser: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

await init();

async function init() {
  bindTabs();
  bindAuth();
  bindImport();
  bindUsers();
  bindRequest();
  await refreshSession();
}

function bindTabs() {
  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".tab").forEach((item) => item.classList.toggle("active", item === button));
      $$(".view").forEach((view) => view.classList.toggle("active", view.id === button.dataset.view));
    });
  });
}

function bindAuth() {
  $("#authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await runWithToast(async () => {
      const session = await api("/api/auth/token", {
        method: "POST",
        body: {
          region: form.get("region"),
          tenant: form.get("tenant"),
          email: form.get("email"),
          password: form.get("password"),
          saveSession: true
        }
      });
      state.session = session;
      renderSession();
      event.currentTarget.reset();
      event.currentTarget.elements.region.value = session.region || "us";
      return "Signed in";
    });
  });

  $("#clearSessionButton").addEventListener("click", async () => {
    await runWithToast(async () => {
      state.session = await api("/api/session", { method: "DELETE" });
      renderSession();
      return "Session cleared";
    });
  });
}

function bindImport() {
  $("#planButton").addEventListener("click", () => runImport(false));
  $("#applyButton").addEventListener("click", () => runImport(true));
}

function bindUsers() {
  $("#loadUsersButton").addEventListener("click", loadUsers);
  $("#userDetailForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const id = form.elements.id.value;
    if (!id) return toast("Select a user first");

    const payload = compactObject({
      name: form.elements.name.value,
      title: form.elements.title.value,
      mobile: form.elements.mobile.value,
      roleNames: splitList(form.elements.roleNames.value)
    });

    await runWithToast(async () => {
      await api(`/api/users/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: payload
      });
      await loadUsers();
      return "User updated";
    });
  });

  $("#deleteUserButton").addEventListener("click", async () => {
    const id = $("#userDetailForm").elements.id.value;
    if (!id) return toast("Select a user first");
    if (!window.confirm("Delete this user?")) return;

    await runWithToast(async () => {
      await api(`/api/users/${encodeURIComponent(id)}`, { method: "DELETE" });
      clearUserDetail();
      await loadUsers();
      return "User deleted";
    });
  });
}

function bindRequest() {
  $("#sendRequestButton").addEventListener("click", async () => {
    await runWithToast(async () => {
      const rawBody = $("#requestBody").value.trim();
      const body = rawBody ? JSON.parse(rawBody) : "";
      const result = await api("/api/request", {
        method: "POST",
        body: {
          method: $("#requestMethod").value,
          url: $("#requestUrl").value,
          body,
          cookieOnly: $("#cookieOnly").checked
        }
      });
      $("#requestResponse").textContent = JSON.stringify(result, null, 2);
      return "Request complete";
    });
  });
}

async function refreshSession() {
  state.session = await api("/api/session");
  renderSession();
}

function renderSession() {
  const pill = $("#sessionPill");
  const session = state.session || {};
  pill.classList.toggle("active", Boolean(session.authenticated));
  pill.textContent = session.authenticated
    ? `${String(session.region || "").toUpperCase()} | ${session.tenant || "tenant"}`
    : "No session";

  const form = $("#authForm");
  if (session.region) form.elements.region.value = session.region;
  if (session.tenant) form.elements.tenant.value = session.tenant;
  if (session.email) form.elements.email.value = session.email;
}

async function runImport(apply) {
  const file = $("#importFile").files[0];
  if (!file) {
    toast("Choose a spreadsheet");
    return;
  }

  const status = $("#importStatus");
  status.classList.remove("error");
  status.textContent = apply ? "Applying..." : "Planning...";

  await runWithToast(async () => {
    const params = new URLSearchParams({
      action: $("#defaultAction").value,
      matchByEmail: String($("#matchByEmail").checked),
      continueOnError: String($("#continueOnError").checked)
    });
    if ($("#sheetName").value.trim()) params.set("sheet", $("#sheetName").value.trim());
    const endpoint = apply ? "/api/users/import/apply" : "/api/users/import/plan";
    const result = await api(`${endpoint}?${params}`, {
      method: "POST",
      rawBody: await file.arrayBuffer(),
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": file.name
      }
    });
    renderImportResults(result);
    return apply ? "Import applied" : "Dry run complete";
  }, (message) => {
    status.classList.add("error");
    status.textContent = message;
  });
}

function renderImportResults(result) {
  const tbody = $("#importResults");
  tbody.innerHTML = "";
  for (const item of result.results || []) {
    const op = item.operation || {};
    const tr = document.createElement("tr");
    const message = item.error || item.errors?.join("; ") || item.response?.messageText || op.warnings?.join("; ") || "";
    tr.innerHTML = `
      <td>${escapeHtml(op.rowNumber || "")}</td>
      <td>${escapeHtml(op.action || "")}</td>
      <td>${escapeHtml(op.id || op.email || op.payload?.email || "")}</td>
      <td><span class="status-badge status-${escapeHtml(item.status || "planned")}">${escapeHtml(item.status || "")}</span></td>
      <td>${escapeHtml(message)}</td>
    `;
    tbody.appendChild(tr);
  }
  $("#importStatus").textContent = `${result.rowCount || 0} rows`;
}

async function loadUsers() {
  const status = $("#usersStatus");
  status.classList.remove("error");
  status.textContent = "Loading...";

  await runWithToast(async () => {
    const params = new URLSearchParams({
      includeNotAssigned: String($("#includeNotAssigned").checked)
    });
    const result = await api(`/api/users?${params}`);
    state.users = result.users || [];
    renderUsers();
    status.textContent = `${state.users.length} users`;
    return "Users refreshed";
  }, (message) => {
    status.classList.add("error");
    status.textContent = message;
  });
}

function renderUsers() {
  const tbody = $("#usersTable");
  tbody.innerHTML = "";

  for (const user of state.users) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(user.fullName || "")}</td>
      <td>${escapeHtml(user.email || "")}</td>
      <td>${escapeHtml((user.roleNames || []).join(", "))}</td>
      <td>${escapeHtml(user.isDeleted ? "Deleted" : user.isInactive ? "Inactive" : "Active")}</td>
    `;
    tr.addEventListener("click", () => selectUser(user));
    tbody.appendChild(tr);
  }
}

async function selectUser(user) {
  await runWithToast(async () => {
    const detail = await api(`/api/users/${encodeURIComponent(user.id)}`);
    state.selectedUser = detail;
    renderUserDetail(detail);
    return "User loaded";
  });
}

function renderUserDetail(user) {
  const form = $("#userDetailForm");
  form.elements.id.value = user.id || "";
  form.elements.visibleId.value = user.id || "";
  form.elements.name.value = user.name || user.fullName || "";
  form.elements.title.value = user.title || "";
  form.elements.mobile.value = user.mobile || "";
  form.elements.roleNames.value = (user.roleNames || []).join(", ");
}

function clearUserDetail() {
  $("#userDetailForm").reset();
}

async function api(path, options = {}) {
  const headers = {
    ...(options.headers || {})
  };
  let body;
  if (options.rawBody !== undefined) {
    body = options.rawBody;
  } else if (options.body !== undefined) {
    headers["content-type"] = headers["content-type"] || "application/json";
    body = JSON.stringify(options.body);
  }

  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(data?.error || `${response.status} ${response.statusText}`);
  }
  return data;
}

async function runWithToast(task, onError) {
  try {
    toast(await task());
  } catch (error) {
    const message = error.message || "Request failed";
    if (onError) onError(message);
    toast(message);
  }
}

function toast(message) {
  const element = $("#toast");
  element.textContent = message;
  element.classList.add("visible");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove("visible"), 2600);
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => {
    if (Array.isArray(value)) return value.length > 0;
    return value !== "";
  }));
}

function splitList(value) {
  return String(value || "").split(/[\n;,]+/g).map((item) => item.trim()).filter(Boolean);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
