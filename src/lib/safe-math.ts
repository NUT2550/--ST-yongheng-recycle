/**
 * Safe math expression parser — no eval, no Function constructor.
 *
 * Supports: + - * / ( ) and decimal numbers.
 * Rejects: letters, symbols, division by zero, empty input.
 *
 * Usage:
 *   const result = parseWeightExpression('860-3');
 *   // => { expression: '860-3', value: 857, isFormula: true }
 *
 *   const result = parseWeightExpression('857');
 *   // => { expression: '857', value: 857, isFormula: false }
 */

export interface WeightExpressionResult {
  expression: string;
  value: number;
  isFormula: boolean;
  error?: string;
}

// Token types
type Token =
  | { type: 'number'; value: number }
  | { type: 'op'; value: '+' | '-' | '*' | '/' }
  | { type: 'lparen' }
  | { type: 'rparen' };

// Tokenizer — only allows numbers, +, -, *, /, (, ), and whitespace
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // Number (including decimals)
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let numStr = '';
      let hasDot = false;
      while (i < input.length && (input[i] >= '0' && input[i] <= '9' || input[i] === '.')) {
        if (input[i] === '.') {
          if (hasDot) {
            throw new Error('ตัวเลขมีจุดทศนิยมซ้ำ');
          }
          hasDot = true;
        }
        numStr += input[i];
        i++;
      }
      const num = parseFloat(numStr);
      if (isNaN(num)) {
        throw new Error(`ตัวเลขไม่ถูกต้อง: ${numStr}`);
      }
      tokens.push({ type: 'number', value: num });
      continue;
    }

    // Operators
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }

    // Parentheses
    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    // Reject anything else (letters, symbols, etc.)
    throw new Error(`อักขระไม่ถูกต้อง: "${ch}"`);
  }

  return tokens;
}

// Recursive descent parser with correct operator precedence
// Grammar:
//   expr   = term (('+' | '-') term)*
//   term   = factor (('*' | '/') factor)*
//   factor = number | '(' expr ')' | '-' factor  (unary minus)

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null;
  }

  private consume(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  parse(): number {
    const result = this.parseExpr();
    if (this.pos < this.tokens.length) {
      throw new Error('สูตรมีอักขระเกินมา');
    }
    return result;
  }

  private parseExpr(): number {
    let left = this.parseTerm();

    while (this.peek()?.type === 'op' && (this.peek() as { type: 'op'; value: string }).value === '+' || (this.peek()?.type === 'op' && (this.peek() as { type: 'op'; value: string }).value === '-')) {
      const op = this.consume() as { type: 'op'; value: '+' | '-' };
      const right = this.parseTerm();
      if (op.value === '+') {
        left = left + right;
      } else {
        left = left - right;
      }
    }

    return left;
  }

  private parseTerm(): number {
    let left = this.parseFactor();

    while (this.peek()?.type === 'op' && ((this.peek() as { type: 'op'; value: string }).value === '*' || (this.peek() as { type: 'op'; value: string }).value === '/')) {
      const op = this.consume() as { type: 'op'; value: '*' | '/' };
      const right = this.parseFactor();
      if (op.value === '*') {
        left = left * right;
      } else {
        if (right === 0) {
          throw new Error('หารด้วยศูนย์ไม่ได้');
        }
        left = left / right;
      }
    }

    return left;
  }

  private parseFactor(): number {
    const token = this.peek();

    if (!token) {
      throw new Error('สูตรไม่สมบูรณ์');
    }

    // Unary minus
    if (token.type === 'op' && token.value === '-') {
      this.consume();
      return -this.parseFactor();
    }

    // Number
    if (token.type === 'number') {
      this.consume();
      return token.value;
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.consume(); // consume '('
      const result = this.parseExpr();
      const next = this.peek();
      if (next?.type !== 'rparen') {
        throw new Error('ไม่ปิดวงเล็บ');
      }
      this.consume(); // consume ')'
      return result;
    }

    throw new Error(`ไม่คาดคิด token: ${JSON.stringify(token)}`);
  }
}

/**
 * Parse a weight expression safely (no eval).
 *
 * @returns WeightExpressionResult with the computed value and original expression
 */
export function parseWeightExpression(input: string): WeightExpressionResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return { expression: '', value: 0, isFormula: false, error: 'กรุณากรอกน้ำหนัก' };
  }

  // Check if it's a simple number (no operators or parentheses)
  const simpleNum = parseFloat(trimmed);
  const isSimpleNumber = !isNaN(simpleNum) && /^-?\d+(\.\d+)?$/.test(trimmed);

  if (isSimpleNumber) {
    return {
      expression: trimmed,
      value: simpleNum,
      isFormula: false,
    };
  }

  // It's a formula — parse it
  try {
    const tokens = tokenize(trimmed);
    if (tokens.length === 0) {
      return { expression: trimmed, value: 0, isFormula: false, error: 'สูตรว่าง' };
    }
    const parser = new Parser(tokens);
    const value = parser.parse();

    // Round to 2 decimal places for display
    const roundedValue = Math.round(value * 100) / 100;

    if (isNaN(roundedValue) || !isFinite(roundedValue)) {
      return { expression: trimmed, value: 0, isFormula: true, error: 'ผลลัพธ์ไม่ถูกต้อง' };
    }

    return {
      expression: trimmed,
      value: roundedValue,
      isFormula: true,
    };
  } catch (e) {
    return {
      expression: trimmed,
      value: 0,
      isFormula: true,
      error: e instanceof Error ? e.message : 'สูตรไม่ถูกต้อง',
    };
  }
}

/**
 * Format weight for display, including the formula if available.
 *
 * @param weight The final numeric weight
 * @param expression Optional original expression (e.g. "860-3")
 * @returns Formatted string like "857.00 กก. (860-3)" or "857.00 กก."
 */
export function formatWeightWithFormula(weight: number, expression?: string): string {
  const formatted = weight.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (expression && expression.trim()) {
    const simpleNum = parseFloat(expression);
    const isSimple = !isNaN(simpleNum) && /^-?\d+(\.\d+)?$/.test(expression.trim());
    if (!isSimple) {
      return `${formatted} (${expression.trim()})`;
    }
  }
  return formatted;
}
