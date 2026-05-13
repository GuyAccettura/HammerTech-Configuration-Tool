import test from "node:test";
import assert from "node:assert/strict";
import { planUserOperations, rowToUserOperation } from "../src/users.js";

test("rowToUserOperation maps create rows into HammerTech payload", () => {
  const op = rowToUserOperation({
    action: "create",
    email: "jane@example.com",
    "Full Name": "Jane Safety",
    title: "Safety Manager",
    roles: "admin;safetymanager",
    isRegionAdmin: "true",
    userProjectIds: "11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222"
  }, { rowNumber: 2 });

  assert.equal(op.action, "create");
  assert.deepEqual(op.errors, []);
  assert.deepEqual(op.payload, {
    email: "jane@example.com",
    name: "Jane Safety",
    title: "Safety Manager",
    roleNames: ["admin", "safetymanager"],
    isRegionAdmin: true,
    userProjectIds: [
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222"
    ]
  });
});

test("planUserOperations reports missing create required fields", () => {
  const plan = planUserOperations([{ action: "create", email: "missing@example.com" }]);
  assert.equal(plan.hasErrors, true);
  assert.match(plan.operations[0].errors.join(" "), /name/);
  assert.match(plan.operations[0].errors.join(" "), /title/);
  assert.match(plan.operations[0].errors.join(" "), /roleNames/);
});

test("rowToUserOperation accepts update rows resolved by email", () => {
  const op = rowToUserOperation({
    action: "update",
    email: "existing@example.com",
    title: "Director",
    mobile: "555"
  });

  assert.deepEqual(op.errors, []);
  assert.deepEqual(op.payload, {
    title: "Director",
    mobile: "555"
  });
});

test("rowToUserOperation can force create for UI spreadsheet imports", () => {
  const op = rowToUserOperation({
    action: "delete",
    id: "11111111-1111-1111-1111-111111111111",
    email: "new@example.com",
    name: "New User",
    title: "Manager",
    roleNames: "safetymanager"
  }, { forceAction: "create" });

  assert.equal(op.action, "create");
  assert.deepEqual(op.errors, []);
  assert.equal(op.payload.email, "new@example.com");
});
