import test from "node:test";
import assert from "node:assert/strict";

import {
  buildRegistryIndex,
  validateRegistry,
} from "../src/index.js";
import { loadRegistryFixture } from "./helpers/fixtures.js";

test("valid fixture passes registry validation", async () => {
  const registry = await loadRegistryFixture("valid-min.json");
  const result = validateRegistry(registry);

  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
});

const invalidFixtures = [
  ["invalid-duplicate-type.json", "REG_DUPLICATE_TYPE"],
  ["invalid-missing-field.json", "REG_MISSING_FIELD"],
  ["invalid-layout-mismatch.json", "REG_LAYOUT_PORT_MISMATCH"],
  ["invalid-parammeta.json", "REG_PARAM_META_INVALID"],
];

for (const [fixtureName, expectedCode] of invalidFixtures) {
  test(`${fixtureName} reports ${expectedCode}`, async () => {
    const registry = await loadRegistryFixture(fixtureName);
    const result = validateRegistry(registry);

    assert.equal(result.ok, false);
    assert.ok(result.errors.some((issue) => issue.code === expectedCode));
  });
}

test("buildRegistryIndex throws when validation fails", async () => {
  const registry = await loadRegistryFixture("invalid-duplicate-type.json");

  assert.throws(() => buildRegistryIndex(registry), {
    name: "RegistryValidationError",
    code: "REG_DUPLICATE_TYPE",
  });
});
