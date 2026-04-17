import test from "node:test";
import assert from "node:assert/strict";

import { DSL_ERROR_CODES, parseGroupDsl } from "../src/index.js";

test("parseGroupDsl parses canonical chain and outlet syntax", () => {
  const result = parseGroupDsl("$0.every(2).drop(3).step(4).count(5).outlet(0)");

  assert.equal(result.ok, true);
  assert.equal(result.ast.statements.length, 1);

  const [statement] = result.ast.statements;

  assert.equal(statement.type, "expr-statement");
  assert.equal(statement.expr.head.type, "inlet-ref");
  assert.equal(statement.expr.head.index, 0);
  assert.deepEqual(
    statement.expr.segments.map((segment) => ({
      name: segment.call.name,
      param: segment.call.param,
      args: segment.call.args.length,
    })),
    [
      { name: "every", param: 2, args: 0 },
      { name: "drop", param: 3, args: 0 },
      { name: "step", param: 4, args: 0 },
      { name: "count", param: 5, args: 0 },
    ],
  );
  assert.deepEqual(statement.expr.terminal, {
    type: "outlet-terminal",
    index: 0,
  });
});

test("parseGroupDsl parses recursive bindings and control-edge distances", () => {
  const source = ["a = $0.every(3){b<6>}", "b = a.count(4)", "b.outlet(0)"].join("\n");
  const result = parseGroupDsl(source);

  assert.equal(result.ok, true);
  assert.equal(result.ast.statements.length, 3);
  assert.equal(result.ast.statements[0].type, "binding-statement");
  assert.equal(result.ast.statements[0].name, "a");
  assert.equal(result.ast.statements[0].expr.segments[0].call.name, "every");
  assert.equal(result.ast.statements[0].expr.segments[0].call.args.length, 1);
  assert.equal(
    result.ast.statements[0].expr.segments[0].call.args[0].head.type,
    "ref",
  );
  assert.equal(
    result.ast.statements[0].expr.segments[0].call.args[0].pendingDistance,
    6,
  );
});

test("parseGroupDsl parses standalone wire statements canonically", () => {
  const source = ["d = demux()", "$0.d[0]", "$1.d[1]", "d.outlet(0)"].join("\n");
  const result = parseGroupDsl(source);

  assert.equal(result.ok, true);
  assert.equal(result.ast.statements[1].type, "wire-statement");
  assert.deepEqual(result.ast.statements[1].source, {
    type: "inlet-ref",
    index: 0,
  });
  assert.deepEqual(result.ast.statements[1].target, {
    type: "ref",
    name: "d",
    index: 0,
  });
});

test("parseGroupDsl ignores comments and blank lines", () => {
  const source = [
    "// $0 = trigger",
    "",
    "$0.every(2).outlet(0) // exported signal",
  ].join("\n");
  const result = parseGroupDsl(source);

  assert.equal(result.ok, true);
  assert.equal(result.ast.statements.length, 1);
  assert.deepEqual(result.ast.comments, [
    { line: 1, text: " $0 = trigger" },
    { line: 3, text: " exported signal" },
  ]);
});

test("parseGroupDsl rejects malformed syntax with DSL_PARSE_* errors", () => {
  const result = parseGroupDsl("a = every(3){b<6>");

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, DSL_ERROR_CODES.PARSE_SYNTAX);
});

test("parseGroupDsl rejects the pre-swap param and control delimiter forms", () => {
  const oldParam = parseGroupDsl("$0.every{2}.outlet(0)");
  const oldControl = parseGroupDsl("pulse(3).every($0).out()");

  assert.equal(oldParam.ok, false);
  assert.equal(oldParam.errors[0].code, DSL_ERROR_CODES.PARSE_SYNTAX);
  assert.equal(oldControl.ok, false);
  assert.equal(oldControl.errors[0].code, DSL_ERROR_CODES.PARSE_SYNTAX);
});
