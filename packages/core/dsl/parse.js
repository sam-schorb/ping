import {
  DSL_ERROR_CODES,
  createDslIssue,
} from "./errors.js";

export const DSL_RESERVED_WORDS = new Set([
  "pulse",
  "out",
  "mux",
  "demux",
  "switch",
  "block",
  "add",
  "sub",
  "set",
  "const1",
  "const2",
  "const3",
  "const4",
  "const5",
  "const6",
  "const7",
  "const8",
  "speed",
  "pitch",
  "decay",
  "crush",
  "hpf",
  "lpf",
  "every",
  "random",
  "counter",
  "gtp",
  "ltp",
  "gtep",
  "ltep",
  "match",
  "group",
  "outlet",
]);

function isIdentifierStart(char) {
  return /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return /[A-Za-z0-9_]/.test(char);
}

function splitComment(rawLine) {
  const commentIndex = rawLine.indexOf("//");

  if (commentIndex === -1) {
    return {
      statementText: rawLine,
      commentText: null,
    };
  }

  return {
    statementText: rawLine.slice(0, commentIndex),
    commentText: rawLine.slice(commentIndex + 2),
  };
}

function findTopLevelEquals(text) {
  let roundDepth = 0;
  let squareDepth = 0;
  let curlyDepth = 0;
  let angleDepth = 0;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (char === "(") {
      roundDepth += 1;
      continue;
    }

    if (char === ")") {
      roundDepth -= 1;
      continue;
    }

    if (char === "[") {
      squareDepth += 1;
      continue;
    }

    if (char === "]") {
      squareDepth -= 1;
      continue;
    }

    if (char === "{") {
      curlyDepth += 1;
      continue;
    }

    if (char === "}") {
      curlyDepth -= 1;
      continue;
    }

    if (char === "<") {
      angleDepth += 1;
      continue;
    }

    if (char === ">") {
      angleDepth -= 1;
      continue;
    }

    if (
      char === "=" &&
      roundDepth === 0 &&
      squareDepth === 0 &&
      curlyDepth === 0 &&
      angleDepth === 0
    ) {
      return index;
    }
  }

  return -1;
}

class LineParser {
  constructor(text, line) {
    this.text = text;
    this.line = line;
    this.index = 0;
  }

  clone() {
    const cloned = new LineParser(this.text, this.line);
    cloned.index = this.index;
    return cloned;
  }

  eof() {
    return this.index >= this.text.length;
  }

  peek(offset = 0) {
    return this.text[this.index + offset] ?? "";
  }

  skipWhitespace() {
    while (!this.eof() && /\s/.test(this.peek())) {
      this.index += 1;
    }
  }

  createSyntaxError(message, column = this.index + 1) {
    return createDslIssue(DSL_ERROR_CODES.PARSE_SYNTAX, message, {
      line: this.line,
      column,
    });
  }

  expect(char, message) {
    if (this.peek() !== char) {
      throw this.createSyntaxError(message);
    }

    this.index += 1;
  }

  parseIdentifier() {
    this.skipWhitespace();

    if (!isIdentifierStart(this.peek())) {
      throw this.createSyntaxError("Expected identifier.");
    }

    const start = this.index;
    this.index += 1;

    while (isIdentifierPart(this.peek())) {
      this.index += 1;
    }

    return this.text.slice(start, this.index);
  }

  parseIndexValue() {
    this.skipWhitespace();

    if (!/[0-9]/.test(this.peek())) {
      throw this.createSyntaxError("Expected integer index.");
    }

    const start = this.index;

    while (/[0-9]/.test(this.peek())) {
      this.index += 1;
    }

    return Number(this.text.slice(start, this.index));
  }

  parseIndexer() {
    this.skipWhitespace();

    if (this.peek() !== "[") {
      return null;
    }

    this.index += 1;

    if (/\s/.test(this.peek())) {
      throw this.createSyntaxError("Indexed references must not contain spaces.");
    }

    const value = this.parseIndexValue();

    if (/\s/.test(this.peek())) {
      throw this.createSyntaxError("Indexed references must not contain spaces.");
    }

    this.expect("]", 'Expected "]" to close indexer.');
    return value;
  }

  parseDistance() {
    this.skipWhitespace();

    if (this.peek() !== "<") {
      return null;
    }

    this.index += 1;

    if (/\s/.test(this.peek())) {
      throw this.createSyntaxError("Distance annotations must not contain spaces.");
    }

    const value = this.parseIndexValue();

    if (/\s/.test(this.peek())) {
      throw this.createSyntaxError("Distance annotations must not contain spaces.");
    }

    this.expect(">", 'Expected ">" to close distance annotation.');
    return value;
  }

  parseParamClause() {
    this.skipWhitespace();

    if (this.peek() !== "(") {
      return null;
    }

    this.index += 1;

    if (/\s/.test(this.peek())) {
      throw this.createSyntaxError("Param clauses must not contain spaces.");
    }

    const value = this.parseIndexValue();

    if (/\s/.test(this.peek())) {
      throw this.createSyntaxError("Param clauses must not contain spaces.");
    }

    this.expect(")", 'Expected ")" to close param clause.');
    return value;
  }

  parseRefFromIdentifier(name) {
    return {
      type: "ref",
      name,
      index: this.parseIndexer(),
    };
  }

  parseRef() {
    return this.parseRefFromIdentifier(this.parseIdentifier());
  }

  parseInletRef() {
    this.skipWhitespace();

    if (this.peek() !== "$") {
      throw this.createSyntaxError('Expected "$" boundary inlet reference.');
    }

    this.index += 1;
    const inletIndex = this.parseIndexValue();

    return {
      type: "inlet-ref",
      index: inletIndex,
    };
  }

  parseControlArgList() {
    const args = [];

    this.skipWhitespace();

    if (this.peek() === "}") {
      return args;
    }

    while (true) {
      args.push(this.parseSignalExpr({ allowTerminal: false }));
      this.skipWhitespace();

      if (this.peek() !== ",") {
        break;
      }

      this.index += 1;
      this.skipWhitespace();
    }

    return args;
  }

  parseNodeCallFromIdentifier(name) {
    const parserAfterWhitespace = this.clone();
    const sawWhitespace = /\s/.test(parserAfterWhitespace.peek());
    parserAfterWhitespace.skipWhitespace();

    if (sawWhitespace && (parserAfterWhitespace.peek() === "(" || parserAfterWhitespace.peek() === "{")) {
      throw this.createSyntaxError(
        "Node calls must not contain spaces after the node name.",
      );
    }

    let param = null;
    let isZeroArgCall = false;

    this.skipWhitespace();

    if (this.peek() === "(") {
      const parserAfterParam = this.clone();
      parserAfterParam.index += 1;
      parserAfterParam.skipWhitespace();

      if (parserAfterParam.peek() === ")") {
        parserAfterParam.index += 1;
        this.index = parserAfterParam.index;
        isZeroArgCall = true;
      } else {
        param = this.parseParamClause();
      }
    }

    this.skipWhitespace();
    let args = null;

    if (this.peek() === "{") {
      this.index += 1;
      args = this.parseControlArgList();
      this.skipWhitespace();
      this.expect("}", 'Expected "}" to close control clause.');
    }

    if (param === null && args === null && !isZeroArgCall) {
      return null;
    }

    return {
      type: "node-call",
      name,
      param,
      args: args ?? [],
    };
  }

  parseSourceAtom() {
    this.skipWhitespace();

    if (this.peek() === "$") {
      return this.parseInletRef();
    }

    const identifier = this.parseIdentifier();
    const parserAfterIdentifier = this.clone();
    const nodeCall = parserAfterIdentifier.parseNodeCallFromIdentifier(identifier);

    if (nodeCall) {
      this.index = parserAfterIdentifier.index;
      return nodeCall;
    }

    return this.parseRefFromIdentifier(identifier);
  }

  parseTerminal() {
    this.skipWhitespace();

    if (this.peek() !== ".") {
      return null;
    }

    const parser = this.clone();
    parser.index += 1;
    const name = parser.parseIdentifier();

    if (name === "out") {
      parser.skipWhitespace();
      parser.expect("(", 'Expected "(" after .out.');
      parser.skipWhitespace();
      parser.expect(")", 'Expected ")" after .out(.');
      this.index = parser.index;
      return {
        type: "out-terminal",
      };
    }

    if (name === "outlet") {
      parser.skipWhitespace();
      parser.expect("(", 'Expected "(" after .outlet.');
      const outletIndex = parser.parseIndexValue();
      parser.skipWhitespace();
      parser.expect(")", 'Expected ")" after .outlet(.');
      this.index = parser.index;
      return {
        type: "outlet-terminal",
        index: outletIndex,
      };
    }

    return null;
  }

  parseNodeCallSegment() {
    this.skipWhitespace();

    const name = this.parseIdentifier();
    const nodeCall = this.parseNodeCallFromIdentifier(name);

    if (!nodeCall) {
      throw this.createSyntaxError(
        `Expected node call after ".", found reference "${name}".`,
      );
    }

    return nodeCall;
  }

  parseSignalExpr({ allowTerminal = true } = {}) {
    const head = this.parseSourceAtom();
    const segments = [];
    let pendingDistance = null;
    let terminal = null;

    while (true) {
      this.skipWhitespace();
      const distance = this.parseDistance();
      this.skipWhitespace();

      if (distance !== null) {
        if (this.peek() === ".") {
          this.index += 1;
          const segmentCall = this.parseNodeCallSegment();
          segments.push({
            distance,
            call: segmentCall,
          });
          continue;
        }

        pendingDistance = distance;
        break;
      }

      const nextTerminal = allowTerminal ? this.parseTerminal() : null;

      if (nextTerminal) {
        terminal = nextTerminal;
        break;
      }

      this.skipWhitespace();

      if (this.peek() !== ".") {
        break;
      }

      this.index += 1;
      const segmentCall = this.parseNodeCallSegment();
      segments.push({
        distance: null,
        call: segmentCall,
      });
    }

    return {
      type: "expression",
      head,
      segments,
      terminal,
      pendingDistance,
    };
  }

  ensureEof() {
    this.skipWhitespace();

    if (!this.eof()) {
      throw this.createSyntaxError(`Unexpected token "${this.peek()}".`);
    }
  }

  parseWire() {
    const source = this.peek() === "$" ? this.parseInletRef() : this.parseRef();
    const distance = this.parseDistance();
    this.skipWhitespace();
    this.expect(".", 'Expected "." in wire statement.');
    const target = this.parseRef();
    this.ensureEof();

    return {
      type: "wire-statement",
      source,
      distance,
      target,
    };
  }
}

function tryParseWireStatement(text, line) {
  try {
    const parser = new LineParser(text, line);
    const startsWithInlet = parser.peek() === "$";
    let identifier = null;

    if (!startsWithInlet) {
      identifier = parser.parseIdentifier();
      const lookahead = parser.clone();
      const asNodeCall = lookahead.parseNodeCallFromIdentifier(identifier);

      if (asNodeCall) {
        return null;
      }

      parser.index = 0;
    }

    return parser.parseWire();
  } catch {
    return null;
  }
}

function parseStatementText(text, line) {
  const equalsIndex = findTopLevelEquals(text);

  if (equalsIndex !== -1) {
    const left = text.slice(0, equalsIndex).trim();
    const right = text.slice(equalsIndex + 1).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(left)) {
      return {
        ok: false,
        error: createDslIssue(
          DSL_ERROR_CODES.PARSE_SYNTAX,
          "Binding left-hand side must be a single identifier.",
          {
            line,
            column: Math.max(equalsIndex, 1),
          },
        ),
      };
    }

    if (right.length === 0) {
      return {
        ok: false,
        error: createDslIssue(
          DSL_ERROR_CODES.PARSE_SYNTAX,
          "Binding must include an expression on the right-hand side.",
          {
            line,
            column: equalsIndex + 2,
          },
        ),
      };
    }

    try {
      const parser = new LineParser(right, line);
      const expr = parser.parseSignalExpr({ allowTerminal: true });
      parser.ensureEof();

      return {
        ok: true,
        statement: {
          type: "binding-statement",
          name: left,
          expr,
          line,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error,
      };
    }
  }

  const wire = tryParseWireStatement(text, line);

  if (wire) {
    return {
      ok: true,
      statement: {
        ...wire,
        line,
      },
    };
  }

  try {
    const parser = new LineParser(text, line);
    const expr = parser.parseSignalExpr({ allowTerminal: true });
    parser.ensureEof();

    return {
      ok: true,
      statement: {
        type: "expr-statement",
        expr,
        line,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error,
    };
  }
}

export function parseGroupDsl(source, options = {}) {
  if (typeof source !== "string") {
    return {
      ok: false,
      errors: [
        createDslIssue(
          DSL_ERROR_CODES.PARSE_INVALID_SOURCE,
          "DSL source must be a string.",
        ),
      ],
    };
  }

  const statements = [];
  const comments = [];
  const lines = source.split(/\r?\n/u);

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const { statementText, commentText } = splitComment(lines[index]);

    if (commentText !== null) {
      comments.push({
        line: lineNumber,
        text: commentText,
      });
    }

    const trimmedStatement = statementText.trim();

    if (trimmedStatement.length === 0) {
      continue;
    }

    const parsedStatement = parseStatementText(trimmedStatement, lineNumber);

    if (!parsedStatement.ok) {
      return {
        ok: false,
        errors: [parsedStatement.error],
      };
    }

    statements.push(parsedStatement.statement);
  }

  return {
    ok: true,
    ast: {
      type: "dsl-file",
      source,
      comments,
      statements,
      ...(options.sourceName ? { sourceName: options.sourceName } : {}),
    },
  };
}
