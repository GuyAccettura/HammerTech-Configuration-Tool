import test from "node:test";
import assert from "node:assert/strict";
import { planEntityCreateOperations, rowToEntityCreateOperation, normalizePatchPayload } from "../src/entities.js";

test("rowToEntityCreateOperation maps project create rows", () => {
  const op = rowToEntityCreateOperation("projects", {
    name: "Downtown Tower",
    country: "United States",
    timeZoneString: "Central Standard Time",
    value: "12345.67",
    isArchived: "false"
  }, { rowNumber: 2 });

  assert.equal(op.action, "create");
  assert.deepEqual(op.errors, []);
  assert.equal(op.payload.name, "Downtown Tower");
  assert.equal(op.payload.value, 12345.67);
  assert.equal(op.payload.isArchived, false);
});

test("planEntityCreateOperations reports missing project required fields", () => {
  const plan = planEntityCreateOperations("projects", [{ name: "Missing Data" }]);
  assert.equal(plan.hasErrors, true);
  assert.match(plan.operations[0].errors.join(" "), /country/);
  assert.match(plan.operations[0].errors.join(" "), /timeZoneString/);
});

test("rowToEntityCreateOperation maps employer profile create rows", () => {
  const op = rowToEntityCreateOperation("employer-profiles", {
    businessName: "Acme Contractors",
    "Regional ID": "12-3456789",
    internalId: "EMPLOYER-1001"
  });

  assert.deepEqual(op.errors, []);
  assert.deepEqual(op.payload, {
    businessName: "Acme Contractors",
    abn: "12-3456789",
    internalIdentifier: "EMPLOYER-1001"
  });
});

test("normalizePatchPayload keeps only allowed fields", () => {
  assert.deepEqual(normalizePatchPayload("employer-profiles", {
    businessName: "Updated",
    regionalEntityIdentifier: "99",
    unknown: "ignored"
  }), {
    businessName: "Updated",
    abn: "99"
  });
});
