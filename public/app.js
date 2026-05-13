const state = {
  session: null,
  users: [],
  projects: [],
  employerProfiles: [],
  selectedIds: new Set(),
  selectedProjectIds: new Set(),
  selectedEmployerIds: new Set()
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

await init();

async function init() {
  bindTabs();
  bindAuth();
  bindImport();
  bindUsers();
  bindProjects();
  bindEmployers();
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
  $("#importEntity").addEventListener("change", updateTemplateLink);
  $("#planButton").addEventListener("click", () => runImport(false));
  $("#applyButton").addEventListener("click", () => runImport(true));
  updateTemplateLink();
}

function bindUsers() {
  $("#loadUsersButton").addEventListener("click", loadUsers);
  $("#userSearch").addEventListener("input", renderUsers);
  $("#selectAllUsers").addEventListener("change", (event) => {
    setVisibleSelection(event.target.checked);
  });
  $("#selectVisibleButton").addEventListener("click", () => setVisibleSelection(true));
  $("#clearSelectionButton").addEventListener("click", () => {
    state.selectedIds.clear();
    renderUsers();
  });

  $("#bulkUpdateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await bulkUpdateUsers(event.currentTarget);
  });

  $("#bulkDeleteButton").addEventListener("click", bulkDeleteUsers);
}

function bindProjects() {
  $("#loadProjectsButton").addEventListener("click", loadProjects);
  $("#projectSearch").addEventListener("input", renderProjects);
  $("#selectAllProjects").addEventListener("change", (event) => setVisibleProjectSelection(event.target.checked));
  $("#selectVisibleProjectsButton").addEventListener("click", () => setVisibleProjectSelection(true));
  $("#clearProjectSelectionButton").addEventListener("click", () => {
    state.selectedProjectIds.clear();
    renderProjects();
  });
  $("#bulkProjectUpdateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await bulkUpdateProjects(event.currentTarget);
  });
}

function bindEmployers() {
  $("#loadEmployersButton").addEventListener("click", loadEmployers);
  $("#employerSearch").addEventListener("input", renderEmployers);
  $("#selectAllEmployers").addEventListener("change", (event) => setVisibleEmployerSelection(event.target.checked));
  $("#selectVisibleEmployersButton").addEventListener("click", () => setVisibleEmployerSelection(true));
  $("#clearEmployerSelectionButton").addEventListener("click", () => {
    state.selectedEmployerIds.clear();
    renderEmployers();
  });
  $("#bulkEmployerUpdateForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await bulkUpdateEmployers(event.currentTarget);
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
    const entity = $("#importEntity").value;
    const params = new URLSearchParams({
      continueOnError: String($("#continueOnError").checked)
    });
    if ($("#sheetName").value.trim()) params.set("sheet", $("#sheetName").value.trim());
    const endpoint = apply ? `/api/${entity}/import/apply` : `/api/${entity}/import/plan`;
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
      <td>${escapeHtml(importTarget(op))}</td>
      <td><span class="status-badge status-${escapeHtml(item.status || "planned")}">${escapeHtml(item.status || "")}</span></td>
      <td>${escapeHtml(message)}</td>
    `;
    tbody.appendChild(tr);
  }
  $("#importStatus").textContent = `${result.rowCount || 0} rows`;
}

function updateTemplateLink() {
  const entity = $("#importEntity").value;
  $("#templateLink").href = `/api/templates/${entity}.csv`;
}

function importTarget(operation) {
  const payload = operation.payload || {};
  return payload.email || payload.name || payload.businessName || operation.email || operation.name || operation.id || "";
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
    state.selectedIds.clear();
    renderUsers();
    status.textContent = `${state.users.length} users loaded`;
    return "Users refreshed";
  }, (message) => {
    status.classList.add("error");
    status.textContent = message;
  });
}

function renderUsers() {
  const tbody = $("#usersTable");
  tbody.innerHTML = "";

  for (const user of visibleUsers()) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="select-col">
        <input class="user-select" type="checkbox" aria-label="Select ${escapeHtml(user.email || user.fullName || "user")}" data-id="${escapeHtml(user.id)}" ${state.selectedIds.has(user.id) ? "checked" : ""}>
      </td>
      <td>${escapeHtml(user.fullName || "")}</td>
      <td>${escapeHtml(user.email || "")}</td>
      <td>${escapeHtml((user.roleNames || []).join(", "))}</td>
      <td>${escapeHtml(user.isDeleted ? "Deleted" : user.isInactive ? "Inactive" : "Active")}</td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.matches("input")) return;
      toggleSelected(user.id);
    });
    tbody.appendChild(tr);
  }

  $$(".user-select").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      setSelected(event.target.dataset.id, event.target.checked);
    });
  });
  renderSelectionState();
}

function visibleUsers() {
  const search = $("#userSearch").value.trim().toLowerCase();
  if (!search) return state.users;
  return state.users.filter((user) => {
    return [user.fullName, user.email, (user.roleNames || []).join(", ")]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
}

function toggleSelected(id) {
  setSelected(id, !state.selectedIds.has(id));
  renderUsers();
}

function setSelected(id, selected) {
  if (!id) return;
  if (selected) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  renderSelectionState();
}

function setVisibleSelection(selected) {
  for (const user of visibleUsers()) {
    if (selected) state.selectedIds.add(user.id);
    else state.selectedIds.delete(user.id);
  }
  renderUsers();
}

function renderSelectionState() {
  const visible = visibleUsers();
  const selectedVisible = visible.filter((user) => state.selectedIds.has(user.id)).length;
  const allCheckbox = $("#selectAllUsers");
  allCheckbox.checked = Boolean(visible.length && selectedVisible === visible.length);
  allCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  $("#selectionCount").textContent = `${state.selectedIds.size} selected`;
}

async function bulkUpdateUsers(form) {
  const ids = Array.from(state.selectedIds);
  if (!ids.length) return toast("Select at least one user");

  const payload = {};
  if ($("#updateTitleEnabled").checked) {
    const title = form.elements.title.value.trim();
    if (!title) return toast("Enter a title");
    payload.title = title;
  }

  if ($("#updateRolesEnabled").checked) {
    const roles = checkedValues(form.elements.roleNames);
    if (!roles.length) return toast("Choose at least one role");
    payload.roleNames = roles;
  }

  if ($("#updateProjectsEnabled").checked) {
    const projectIds = splitList(form.elements.userProjectIds.value);
    if (!projectIds.length) return toast("Enter at least one project ID");
    payload.userProjectIds = projectIds;
  }

  if (!Object.keys(payload).length) return toast("Choose at least one update field");

  await runWithToast(async () => {
    const result = await api("/api/users/bulk/update", {
      method: "POST",
      body: {
        ids,
        payload,
        resetProjectPermissions: form.elements.resetProjectPermissions.checked,
        continueOnError: form.elements.continueOnError.checked
      }
    });
    reportBulkResult(result, "updated");
    await loadUsers();
    return "Bulk update complete";
  }, showUsersError);
}

async function bulkDeleteUsers() {
  const ids = Array.from(state.selectedIds);
  if (!ids.length) return toast("Select at least one user");
  if (!window.confirm(`Delete ${ids.length} selected user${ids.length === 1 ? "" : "s"}?`)) return;

  const form = $("#bulkUpdateForm");
  await runWithToast(async () => {
    const result = await api("/api/users/bulk/delete", {
      method: "POST",
      body: {
        ids,
        continueOnError: form.elements.continueOnError.checked
      }
    });
    reportBulkResult(result, "deleted");
    state.selectedIds.clear();
    await loadUsers();
    return "Bulk delete complete";
  }, showUsersError);
}

function reportBulkResult(result, verb) {
  const results = result.results || [];
  const failed = results.filter((item) => item.status === "failed");
  $("#usersStatus").textContent = `${results.length - failed.length} ${verb}, ${failed.length} failed`;
  $("#usersStatus").classList.toggle("error", failed.length > 0);
}

function showUsersError(message) {
  const status = $("#usersStatus");
  status.classList.add("error");
  status.textContent = message;
}

async function loadProjects() {
  const status = $("#projectsStatus");
  status.classList.remove("error");
  status.textContent = "Loading...";

  await runWithToast(async () => {
    const params = new URLSearchParams({
      includeArchived: String($("#includeArchivedProjects").checked)
    });
    const result = await api(`/api/projects?${params}`);
    state.projects = result.projects || [];
    state.selectedProjectIds.clear();
    renderProjects();
    status.textContent = `${state.projects.length} projects loaded`;
    return "Projects refreshed";
  }, (message) => showEntityError("#projectsStatus", message));
}

function renderProjects() {
  const tbody = $("#projectsTable");
  tbody.innerHTML = "";

  for (const project of visibleProjects()) {
    const id = project.projectId || project.id;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="select-col">
        <input class="project-select" type="checkbox" aria-label="Select ${escapeHtml(project.name || "project")}" data-id="${escapeHtml(id)}" ${state.selectedProjectIds.has(id) ? "checked" : ""}>
      </td>
      <td>${escapeHtml(project.name || "")}</td>
      <td>${escapeHtml(project.clientName || "")}</td>
      <td>${escapeHtml(project.country || "")}</td>
      <td>${escapeHtml(project.state || "")}</td>
      <td>${escapeHtml(project.isArchived ? "Archived" : "Active")}</td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.matches("input")) return;
      toggleProjectSelected(id);
    });
    tbody.appendChild(tr);
  }

  $$(".project-select").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      setProjectSelected(event.target.dataset.id, event.target.checked);
    });
  });
  renderProjectSelectionState();
}

function visibleProjects() {
  const search = $("#projectSearch").value.trim().toLowerCase();
  if (!search) return state.projects;
  return state.projects.filter((project) => {
    return [project.name, project.clientName, project.internalIdentifier, project.country, project.state]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
}

function toggleProjectSelected(id) {
  setProjectSelected(id, !state.selectedProjectIds.has(id));
  renderProjects();
}

function setProjectSelected(id, selected) {
  if (!id) return;
  if (selected) state.selectedProjectIds.add(id);
  else state.selectedProjectIds.delete(id);
  renderProjectSelectionState();
}

function setVisibleProjectSelection(selected) {
  for (const project of visibleProjects()) {
    const id = project.projectId || project.id;
    if (selected) state.selectedProjectIds.add(id);
    else state.selectedProjectIds.delete(id);
  }
  renderProjects();
}

function renderProjectSelectionState() {
  const visible = visibleProjects();
  const selectedVisible = visible.filter((project) => state.selectedProjectIds.has(project.projectId || project.id)).length;
  const allCheckbox = $("#selectAllProjects");
  allCheckbox.checked = Boolean(visible.length && selectedVisible === visible.length);
  allCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  $("#projectSelectionCount").textContent = `${state.selectedProjectIds.size} selected`;
}

async function bulkUpdateProjects(form) {
  const ids = Array.from(state.selectedProjectIds);
  if (!ids.length) return toast("Select at least one project");
  const payload = payloadFromEnabledFields(form);
  if (!Object.keys(payload).length) return toast("Choose at least one update field");

  await runWithToast(async () => {
    const result = await api("/api/projects/bulk/update", {
      method: "POST",
      body: {
        ids,
        payload,
        continueOnError: form.elements.continueOnError.checked
      }
    });
    reportEntityBulkResult("#projectsStatus", result, "updated");
    await loadProjects();
    return "Project update complete";
  }, (message) => showEntityError("#projectsStatus", message));
}

async function loadEmployers() {
  const status = $("#employersStatus");
  status.classList.remove("error");
  status.textContent = "Loading...";

  await runWithToast(async () => {
    const result = await api("/api/employer-profiles");
    state.employerProfiles = result.employerProfiles || [];
    state.selectedEmployerIds.clear();
    renderEmployers();
    status.textContent = `${state.employerProfiles.length} employer profiles loaded`;
    return "Employer profiles refreshed";
  }, (message) => showEntityError("#employersStatus", message));
}

function renderEmployers() {
  const tbody = $("#employersTable");
  tbody.innerHTML = "";

  for (const employer of visibleEmployers()) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="select-col">
        <input class="employer-select" type="checkbox" aria-label="Select ${escapeHtml(employer.businessName || "employer profile")}" data-id="${escapeHtml(employer.id)}" ${state.selectedEmployerIds.has(employer.id) ? "checked" : ""}>
      </td>
      <td>${escapeHtml(employer.businessName || "")}</td>
      <td>${escapeHtml(employer.regionalEntityIdentifier || "")}</td>
      <td>${escapeHtml(employer.internalIdentifier || "")}</td>
      <td>${escapeHtml(employer.deactivatedDate ? "Deactivated" : "Active")}</td>
    `;
    tr.addEventListener("click", (event) => {
      if (event.target.matches("input")) return;
      toggleEmployerSelected(employer.id);
    });
    tbody.appendChild(tr);
  }

  $$(".employer-select").forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      setEmployerSelected(event.target.dataset.id, event.target.checked);
    });
  });
  renderEmployerSelectionState();
}

function visibleEmployers() {
  const search = $("#employerSearch").value.trim().toLowerCase();
  if (!search) return state.employerProfiles;
  return state.employerProfiles.filter((employer) => {
    return [employer.businessName, employer.regionalEntityIdentifier, employer.internalIdentifier]
      .some((value) => String(value || "").toLowerCase().includes(search));
  });
}

function toggleEmployerSelected(id) {
  setEmployerSelected(id, !state.selectedEmployerIds.has(id));
  renderEmployers();
}

function setEmployerSelected(id, selected) {
  if (!id) return;
  if (selected) state.selectedEmployerIds.add(id);
  else state.selectedEmployerIds.delete(id);
  renderEmployerSelectionState();
}

function setVisibleEmployerSelection(selected) {
  for (const employer of visibleEmployers()) {
    if (selected) state.selectedEmployerIds.add(employer.id);
    else state.selectedEmployerIds.delete(employer.id);
  }
  renderEmployers();
}

function renderEmployerSelectionState() {
  const visible = visibleEmployers();
  const selectedVisible = visible.filter((employer) => state.selectedEmployerIds.has(employer.id)).length;
  const allCheckbox = $("#selectAllEmployers");
  allCheckbox.checked = Boolean(visible.length && selectedVisible === visible.length);
  allCheckbox.indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
  $("#employerSelectionCount").textContent = `${state.selectedEmployerIds.size} selected`;
}

async function bulkUpdateEmployers(form) {
  const ids = Array.from(state.selectedEmployerIds);
  if (!ids.length) return toast("Select at least one employer profile");
  const payload = payloadFromEnabledFields(form);
  if (!Object.keys(payload).length) return toast("Choose at least one update field");

  await runWithToast(async () => {
    const result = await api("/api/employer-profiles/bulk/update", {
      method: "POST",
      body: {
        ids,
        payload,
        continueOnError: form.elements.continueOnError.checked
      }
    });
    reportEntityBulkResult("#employersStatus", result, "updated");
    await loadEmployers();
    return "Employer profile update complete";
  }, (message) => showEntityError("#employersStatus", message));
}

function payloadFromEnabledFields(form) {
  const enabled = checkedValues(form.elements.enabledFields);
  const payload = {};
  for (const field of enabled) {
    const input = form.elements[field];
    if (!input) continue;
    const value = input.value.trim();
    if (value !== "") payload[field] = value;
  }
  return payload;
}

function reportEntityBulkResult(statusSelector, result, verb) {
  const results = result.results || [];
  const failed = results.filter((item) => item.status === "failed");
  const status = $(statusSelector);
  status.textContent = `${results.length - failed.length} ${verb}, ${failed.length} failed`;
  status.classList.toggle("error", failed.length > 0);
}

function showEntityError(statusSelector, message) {
  const status = $(statusSelector);
  status.classList.add("error");
  status.textContent = message;
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

function splitList(value) {
  return String(value || "").split(/[\n;,]+/g).map((item) => item.trim()).filter(Boolean);
}

function checkedValues(inputOrList) {
  const values = inputOrList && typeof inputOrList.length === "number" && !("checked" in inputOrList)
    ? Array.from(inputOrList)
    : [inputOrList];
  return values.filter((input) => input.checked).map((input) => input.value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}
