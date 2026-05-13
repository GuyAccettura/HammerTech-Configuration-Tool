export const ENTITY_CONFIGS = {
  projects: {
    singular: "project",
    displayName: "Projects",
    templateFile: "projects-template.csv",
    idField: "projectId",
    createFields: [
      "projectId",
      "isArchived",
      "name",
      "siteAddress",
      "domain",
      "regionId",
      "regionString",
      "weatherForecastLocationId",
      "weatherObservationLocationId",
      "isPublicProjectSiteHidden",
      "isPublicProjectSiteVisibleToLoggedInUsers",
      "state",
      "timeZoneString",
      "timeZoneStringIana",
      "internalIdentifier",
      "country",
      "clientName",
      "value",
      "clientContactName",
      "clientContactPhone",
      "clientContactEmail",
      "expectedStartDate",
      "expectedEndDate"
    ],
    patchFields: [
      "name",
      "siteAddress",
      "regionId",
      "weatherForecastLocationId",
      "weatherObservationLocationId",
      "isPublicProjectSiteHidden",
      "isPublicProjectSiteVisibleToLoggedInUsers",
      "state",
      "internalIdentifier",
      "country",
      "clientName",
      "value",
      "clientContactName",
      "clientContactPhone",
      "clientContactEmail",
      "expectedStartDate",
      "expectedEndDate"
    ],
    requiredCreateFields: ["name", "country", "timeZoneString"],
    booleanFields: [
      "isArchived",
      "isPublicProjectSiteHidden",
      "isPublicProjectSiteVisibleToLoggedInUsers"
    ],
    numberFields: ["value"],
    aliases: {
      id: "projectId",
      projectId: "projectId",
      projectName: "name",
      address: "siteAddress",
      projectAddress: "siteAddress",
      timezone: "timeZoneString",
      timeZone: "timeZoneString",
      ianaTimeZone: "timeZoneStringIana",
      internalId: "internalIdentifier"
    }
  },
  "employer-profiles": {
    singular: "employer profile",
    displayName: "Employer Profiles",
    templateFile: "employer-profiles-template.csv",
    idField: "id",
    createFields: [
      "id",
      "businessName",
      "abn",
      "internalIdentifier",
      "customFieldFormId"
    ],
    patchFields: [
      "businessName",
      "abn",
      "internalIdentifier"
    ],
    requiredCreateFields: ["businessName"],
    booleanFields: [],
    numberFields: [],
    aliases: {
      id: "id",
      name: "businessName",
      employerName: "businessName",
      regionalId: "abn",
      regionalID: "abn",
      "regional id": "abn",
      regionalEntityIdentifier: "abn",
      ein: "abn",
      vat: "abn",
      taxId: "abn",
      internalId: "internalIdentifier"
    }
  }
};

export function getEntityConfig(entity) {
  const config = ENTITY_CONFIGS[entity];
  if (!config) {
    throw new Error(`Unsupported entity "${entity}".`);
  }
  return config;
}

export function rowToEntityCreateOperation(entity, row, { rowNumber = 0 } = {}) {
  const config = getEntityConfig(entity);
  const normalized = normalizeRow(row, config);
  const operation = {
    rowNumber,
    entity,
    action: "create",
    id: normalized[config.idField] ? String(normalized[config.idField]) : "",
    name: normalized.name || normalized.businessName || "",
    payload: {},
    warnings: normalized.__warnings,
    errors: []
  };

  for (const field of config.createFields) {
    if (!(field in normalized)) continue;
    try {
      operation.payload[field] = coerceField(field, normalized[field], config);
    } catch (error) {
      operation.errors.push(`${field}: ${error.message}`);
    }
  }

  for (const field of config.requiredCreateFields) {
    if (operation.payload[field] === undefined || isEmptyValue(operation.payload[field])) {
      operation.errors.push(`Create rows require ${field}.`);
    }
  }

  return operation;
}

export function planEntityCreateOperations(entity, rows) {
  const operations = rows.map((row, index) => rowToEntityCreateOperation(entity, row, {
    rowNumber: index + 2
  }));
  return {
    operations,
    hasErrors: operations.some((operation) => operation.errors.length > 0)
  };
}

export async function executeEntityCreateOperations(client, operations, {
  apply = false,
  continueOnError = false
} = {}) {
  const results = [];
  for (const operation of operations) {
    if (operation.errors.length) {
      results.push({ operation, status: "invalid", errors: operation.errors });
      if (!continueOnError) break;
      continue;
    }

    if (!apply) {
      results.push({ operation, status: "planned" });
      continue;
    }

    try {
      const response = operation.entity === "projects"
        ? await client.createProject(operation.payload)
        : await client.createEmployerProfile(operation.payload);
      results.push({ operation, status: "success", response });
    } catch (error) {
      results.push({
        operation,
        status: "failed",
        error: error.message,
        responseBody: error.responseBody
      });
      if (!continueOnError) break;
    }
  }
  return results;
}

export function normalizePatchPayload(entity, payload) {
  const config = getEntityConfig(entity);
  const allowed = new Set(config.patchFields);
  const normalized = {};
  for (const [key, value] of Object.entries(payload || {})) {
    const field = aliasField(key, config) || key;
    if (!allowed.has(field)) continue;
    if (value === undefined || value === "") continue;
    normalized[field] = coerceField(field, value, config);
  }
  return normalized;
}

export async function listAllProjects(client, query = {}) {
  return listAll((params) => client.listProjects(params), query);
}

export async function listAllEmployerProfiles(client, query = {}) {
  return listAll((params) => client.listEmployerProfiles(params), query);
}

async function listAll(fetchPage, query = {}) {
  const all = [];
  const take = Number(query.take || 100);
  let skip = Number(query.skip || 0);

  while (true) {
    const page = await fetchPage({
      ...query,
      skip,
      take
    });
    if (!Array.isArray(page)) {
      throw new Error("List response was not an array.");
    }
    all.push(...page);
    if (page.length < take) break;
    skip += take;
  }

  return all;
}

function normalizeRow(row, config) {
  const normalized = { __warnings: [] };
  for (const [header, rawValue] of Object.entries(row)) {
    const value = normalizeCell(rawValue);
    if (value === "") continue;

    const field = resolveHeader(header, config);
    if (!field) {
      normalized.__warnings.push(`Unmapped column "${header}" was ignored.`);
      continue;
    }
    normalized[field] = value;
  }
  return normalized;
}

function resolveHeader(header, config) {
  const key = normalizeHeader(header);
  const fields = new Set([...config.createFields, ...config.patchFields]);
  const alias = aliasField(header, config);
  if (alias) return alias;
  for (const field of fields) {
    if (normalizeHeader(field) === key) return field;
  }
  return null;
}

function aliasField(header, config) {
  const key = normalizeHeader(header);
  for (const [alias, field] of Object.entries(config.aliases || {})) {
    if (normalizeHeader(alias) === key) return field;
  }
  return null;
}

function coerceField(field, value, config) {
  if (value === "__null__") return null;
  if (config.booleanFields.includes(field)) return coerceBoolean(value);
  if (config.numberFields.includes(field)) return coerceNumber(value);
  return String(value);
}

function coerceBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value || "").trim().toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(text)) return true;
  if (["false", "f", "no", "n", "0"].includes(text)) return false;
  throw new Error(`Expected boolean value, received "${value}".`);
}

function coerceNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Expected number value, received "${value}".`);
  }
  return number;
}

function normalizeCell(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return text.toLowerCase() === "null" ? "__null__" : text;
}

function normalizeHeader(header) {
  return String(header || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isEmptyValue(value) {
  return value === null || value === undefined || value === "";
}
