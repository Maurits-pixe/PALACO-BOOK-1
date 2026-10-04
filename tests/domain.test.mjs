import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const contract=JSON.parse(fs.readFileSync("docs/veldgids/data-model-v0.1.json","utf8"));
test("contract preserves constitutional invariants",()=>{assert.ok(contract.principles.includes("authentication_is_not_authorization"));assert.ok(contract.principles.includes("provenance_is_required"));assert.ok(contract.principles.includes("no_silent_mutation"));});
