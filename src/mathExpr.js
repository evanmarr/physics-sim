// A small, self-contained expression parser/evaluator for the graphing
// calculator — deliberately not `eval`/`new Function` (arbitrary user text
// should never run as actual JS), and supports the things a real graphing
// calculator needs: implicit multiplication ("2x", "2sin(x)", "(x+1)(x-1)"),
// standard functions/constants, and right-associative exponents (2^3^2 = 512).

const FUNCTIONS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp,
  ln: Math.log, log: Math.log10, log2: Math.log2,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
  min: Math.min, max: Math.max, pow: Math.pow,
};
const CONSTANTS = { pi: Math.PI, e: Math.E };

function tokenize(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      tokens.push({ type: "num", value: parseFloat(src.slice(i, j)) });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z0-9_]/.test(src[j])) j++;
      tokens.push({ type: "id", value: src.slice(i, j) });
      i = j;
    } else if ("+-*/^(),".includes(c)) {
      tokens.push({ type: c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}"`);
    }
  }
  return tokens;
}

// Recursive-descent parser producing a small AST, then a separate eval step
// — kept as two passes (rather than evaluating while parsing) so a syntax
// error is caught once up front, not partway through drawing a curve.
function parse(tokens) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function atPrimaryStart() {
    const t = peek();
    return t && (t.type === "num" || t.type === "id" || t.type === "(");
  }

  function parseExpr() {
    let node = parseTerm();
    while (peek() && (peek().type === "+" || peek().type === "-")) {
      const op = next().type;
      node = { op, a: node, b: parseTerm() };
    }
    return node;
  }
  function parseTerm() {
    let node = parseUnary();
    while (peek() && (peek().type === "*" || peek().type === "/" || atPrimaryStart())) {
      // No explicit * or / — but another primary starts right here — that's
      // implicit multiplication ("2x", "3(x+1)", "2 sin(x)").
      const op = (peek().type === "*" || peek().type === "/") ? next().type : "*";
      node = { op, a: node, b: parseUnary() };
    }
    return node;
  }
  function parseUnary() {
    if (peek() && (peek().type === "-" || peek().type === "+")) {
      const op = next().type;
      return { op: "neg", a: parsePow(), negate: op === "-" };
    }
    return parsePow();
  }
  function parsePow() {
    const base = parsePrimary();
    if (peek() && peek().type === "^") {
      next();
      return { op: "^", a: base, b: parseUnary() }; // right-associative
    }
    return base;
  }
  function parsePrimary() {
    const t = peek();
    if (!t) throw new Error("Unexpected end of expression");
    if (t.type === "num") { next(); return { op: "num", value: t.value }; }
    if (t.type === "(") {
      next();
      const node = parseExpr();
      if (!peek() || peek().type !== ")") throw new Error("Missing closing parenthesis");
      next();
      return node;
    }
    if (t.type === "id") {
      next();
      const name = t.value.toLowerCase();
      if (peek() && peek().type === "(") {
        next();
        const args = [parseExpr()];
        while (peek() && peek().type === ",") { next(); args.push(parseExpr()); }
        if (!peek() || peek().type !== ")") throw new Error("Missing closing parenthesis");
        next();
        if (!FUNCTIONS[name]) throw new Error(`Unknown function "${name}"`);
        return { op: "call", name, args };
      }
      if (name === "x" || CONSTANTS[name] !== undefined) return { op: "var", name };
      throw new Error(`Unknown name "${name}"`);
    }
    throw new Error(`Unexpected token near "${t.type}"`);
  }

  const tree = parseExpr();
  if (pos < tokens.length) throw new Error("Unexpected trailing input");
  return tree;
}

function evalNode(node, x) {
  switch (node.op) {
    case "num": return node.value;
    case "var": return node.name === "x" ? x : CONSTANTS[node.name];
    case "neg": { const v = evalNode(node.a, x); return node.negate ? -v : v; }
    case "+": return evalNode(node.a, x) + evalNode(node.b, x);
    case "-": return evalNode(node.a, x) - evalNode(node.b, x);
    case "*": return evalNode(node.a, x) * evalNode(node.b, x);
    case "/": return evalNode(node.a, x) / evalNode(node.b, x);
    case "^": return Math.pow(evalNode(node.a, x), evalNode(node.b, x));
    case "call": return FUNCTIONS[node.name](...node.args.map((a) => evalNode(a, x)));
    default: throw new Error("Bad node");
  }
}

// Parses `src` once and returns a fast (x) => number closure over the
// resulting tree, or throws with a message meant to be shown directly to
// the person typing (not a JS internals leak).
export function compileExpression(src) {
  if (!src || !src.trim()) return null;
  let tree;
  try {
    tree = parse(tokenize(src));
  } catch (e) {
    throw new Error(e.message || "Couldn't parse that expression");
  }
  return (x) => evalNode(tree, x);
}
