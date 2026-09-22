/**
 * A regular expression matcher whose cost is the product of the pattern's
 * size and the path's length, and never more.
 *
 * jest's `testRegex`, `testPathIgnorePatterns`, and `modulePathIgnorePatterns`
 * are regular expressions a repository states and the runtime evaluates on
 * its own host, against paths the same repository chose. JavaScript's own
 * engine backtracks, so a pattern with several repetitions over the same
 * characters — `a*a*a*a*a*a*a*a*b$` — costs a high power of the path's
 * length, which a file name of a hundred characters turns into minutes of a
 * blocked thread. Refusing the nested-quantifier shapes is not enough: they
 * are the exponential cases, and the polynomial ones hang a service just as
 * well (I9).
 *
 * So the pattern is compiled to a state machine and run as a set of states
 * that advance together, one pass over the path, which is Thompson's
 * construction with Pike's simulation. There is no backtracking to provoke.
 * What cannot be compiled — a backreference, a lookahead or lookbehind — is
 * refused rather than handed to the backtracking engine, because a construct
 * this cannot run linearly is one it cannot promise anything about.
 */
import { refuse } from './refusal.js';

/** A compiled pattern: the same question `RegExp.prototype.test` answers, in bounded time. */
export interface LinearPattern {
  readonly source: string;
  test(input: string): boolean;
}

/** Instructions can be duplicated by a counted repetition, so the program is capped. */
const PROGRAM_CAP = 20_000;

type CharTest = (code: number) => boolean;

type Instruction =
  | { readonly op: 'char'; readonly match: CharTest }
  | { readonly op: 'split'; readonly first: number; readonly second: number }
  | { readonly op: 'jump'; readonly to: number }
  | { readonly op: 'start' }
  | { readonly op: 'end' }
  | { readonly op: 'boundary'; readonly negated: boolean }
  | { readonly op: 'match' };

type Node =
  | { readonly kind: 'empty' }
  | { readonly kind: 'char'; readonly match: CharTest }
  | { readonly kind: 'start' }
  | { readonly kind: 'end' }
  | { readonly kind: 'boundary'; readonly negated: boolean }
  | { readonly kind: 'concat'; readonly parts: readonly Node[] }
  | { readonly kind: 'alternate'; readonly options: readonly Node[] }
  | { readonly kind: 'repeat'; readonly node: Node; readonly min: number; readonly max: number };

const WORD = (code: number): boolean =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 95;
const DIGIT = (code: number): boolean => code >= 48 && code <= 57;
const SPACE = (code: number): boolean =>
  code === 32 || (code >= 9 && code <= 13) || code === 0xa0 || code === 0x1680 || (code >= 0x2000 && code <= 0x200a)
  || code === 0x2028 || code === 0x2029 || code === 0x202f || code === 0x205f || code === 0x3000 || code === 0xfeff;
const LINE_TERMINATOR = (code: number): boolean => code === 10 || code === 13 || code === 0x2028 || code === 0x2029;

const CONTROL_ESCAPES: ReadonlyMap<string, number> = new Map([
  ['t', 9], ['n', 10], ['v', 11], ['f', 12], ['r', 13], ['0', 0],
]);

/** One character class the pattern names by an escape, e.g. `\d`. */
function classEscape(char: string): CharTest | undefined {
  switch (char) {
    case 'd': return DIGIT;
    case 'D': return (code) => !DIGIT(code);
    case 'w': return WORD;
    case 'W': return (code) => !WORD(code);
    case 's': return SPACE;
    case 'S': return (code) => !SPACE(code);
    default: return undefined;
  }
}

class Parser {
  #at = 0;

  constructor(
    private readonly pattern: string,
    private readonly label: string,
  ) {}

  #refuse(why: string): never {
    refuse('unsupported-feature', `${this.label} ${why}: ${this.pattern}`);
  }

  #peek(offset = 0): string {
    return this.pattern[this.#at + offset] ?? '';
  }

  #done(): boolean {
    return this.#at >= this.pattern.length;
  }

  parse(): Node {
    const node = this.#alternation();
    if (!this.#done()) this.#refuse(`has an unbalanced \`${this.#peek()}\` at position ${String(this.#at)}`);
    return node;
  }

  #alternation(): Node {
    const options: Node[] = [this.#sequence()];
    while (this.#peek() === '|') {
      this.#at++;
      options.push(this.#sequence());
    }
    return options.length === 1 ? (options[0] ?? { kind: 'empty' }) : { kind: 'alternate', options };
  }

  #sequence(): Node {
    const parts: Node[] = [];
    while (!this.#done() && this.#peek() !== '|' && this.#peek() !== ')') parts.push(this.#quantified());
    if (parts.length === 0) return { kind: 'empty' };
    return parts.length === 1 ? (parts[0] ?? { kind: 'empty' }) : { kind: 'concat', parts };
  }

  #quantified(): Node {
    const atom = this.#atom();
    for (;;) {
      const char = this.#peek();
      let min: number;
      let max: number;
      if (char === '*') { min = 0; max = Infinity; }
      else if (char === '+') { min = 1; max = Infinity; }
      else if (char === '?') { min = 0; max = 1; }
      else if (char === '{') {
        const counted = /^\{(\d+)(,(\d*)?)?\}/.exec(this.pattern.slice(this.#at));
        if (counted === null) return atom; // `{` that is not a quantifier is a literal, as JS reads it
        min = Number(counted[1]);
        max = counted[2] === undefined ? min : counted[3] === undefined || counted[3] === '' ? Infinity : Number(counted[3]);
        if (max < min) this.#refuse('states a repetition whose maximum is below its minimum');
        this.#at += counted[0].length - 1;
      } else {
        return atom;
      }
      this.#at++;
      // A lazy or possessive marker changes which match is found, never whether one exists, and
      // this matcher answers only whether one exists.
      if (this.#peek() === '?' || this.#peek() === '+') this.#at++;
      return { kind: 'repeat', node: atom, min, max };
    }
  }

  #atom(): Node {
    const char = this.#peek();
    if (char === '(') {
      this.#at++;
      if (this.#peek() === '?') {
        const prefix = /^\?(?::|<[A-Za-z_$][\w$]*>)/.exec(this.pattern.slice(this.#at));
        if (prefix === null) this.#refuse(`uses a lookahead or lookbehind at position ${String(this.#at - 1)}, which cannot be matched in one pass`);
        this.#at += prefix[0].length;
      }
      const inner = this.#alternation();
      if (this.#peek() !== ')') this.#refuse(`has an unclosed group at position ${String(this.#at)}`);
      this.#at++;
      return inner;
    }
    if (char === '[') return this.#characterClass();
    if (char === '^') { this.#at++; return { kind: 'start' }; }
    if (char === '$') { this.#at++; return { kind: 'end' }; }
    if (char === '.') { this.#at++; return { kind: 'char', match: (code) => !LINE_TERMINATOR(code) }; }
    if (char === '\\') return this.#escape();
    if (char === '*' || char === '+' || char === '?') this.#refuse(`has a quantifier with nothing to repeat at position ${String(this.#at)}`);
    this.#at++;
    const code = char.charCodeAt(0);
    return { kind: 'char', match: (c) => c === code };
  }

  #escape(): Node {
    this.#at++;
    const char = this.#peek();
    if (char === '') this.#refuse('ends with a trailing backslash');
    if (/[1-9]/.test(char) || char === 'k') this.#refuse(`uses a backreference at position ${String(this.#at)}, which cannot be matched in one pass`);
    if (char === 'p' || char === 'P') this.#refuse(`uses a unicode property escape at position ${String(this.#at)}`);
    if (char === 'b' || char === 'B') { this.#at++; return { kind: 'boundary', negated: char === 'B' }; }
    const named = classEscape(char);
    if (named !== undefined) { this.#at++; return { kind: 'char', match: named }; }
    const code = this.#escapedCode();
    return { kind: 'char', match: (c) => c === code };
  }

  /** The code unit an escape stands for, with the position left after it. */
  #escapedCode(): number {
    const char = this.#peek();
    const control = CONTROL_ESCAPES.get(char);
    if (control !== undefined) { this.#at++; return control; }
    if (char === 'x' || char === 'u') {
      const digits = char === 'x' ? 2 : 4;
      const hex = this.pattern.slice(this.#at + 1, this.#at + 1 + digits);
      if (!new RegExp(`^[\\da-f]{${String(digits)}}$`, 'i').test(hex)) {
        this.#refuse(`has an incomplete \\${char} escape at position ${String(this.#at)}`);
      }
      this.#at += 1 + digits;
      return parseInt(hex, 16);
    }
    if (char === 'c') {
      const letter = this.#peek(1);
      if (!/[A-Za-z]/.test(letter)) this.#refuse(`has an incomplete control escape at position ${String(this.#at)}`);
      this.#at += 2;
      return letter.toUpperCase().charCodeAt(0) - 64;
    }
    this.#at++;
    return char.charCodeAt(0);
  }

  #characterClass(): Node {
    this.#at++; // `[`
    const negated = this.#peek() === '^';
    if (negated) this.#at++;
    const tests: CharTest[] = [];
    let first = true;
    while (!this.#done() && (this.#peek() !== ']' || first)) {
      first = false;
      const item = this.#classItem();
      if (typeof item !== 'number') {
        tests.push(item);
        continue;
      }
      // A `-` between two single characters is a range; anywhere else it is the character itself.
      if (this.#peek() === '-' && this.#peek(1) !== ']' && this.#peek(1) !== '') {
        this.#at++;
        const upper = this.#classItem();
        if (typeof upper !== 'number') this.#refuse(`ranges over a character class at position ${String(this.#at)}`);
        if (upper < item) this.#refuse(`states a range that runs backwards at position ${String(this.#at)}`);
        tests.push((code) => code >= item && code <= upper);
        continue;
      }
      tests.push((code) => code === item);
    }
    if (this.#peek() !== ']') this.#refuse(`has an unclosed character class at position ${String(this.#at)}`);
    this.#at++;
    const inside = (code: number): boolean => tests.some((test) => test(code));
    return { kind: 'char', match: negated ? (code) => !inside(code) : inside };
  }

  /** One member of a character class: a code unit, or a test for `\d` and its kind. */
  #classItem(): number | CharTest {
    if (this.#peek() !== '\\') {
      const char = this.#peek();
      this.#at++;
      return char.charCodeAt(0);
    }
    this.#at++;
    const char = this.#peek();
    if (char === '') this.#refuse('ends with a trailing backslash');
    if (char === 'k' || /[1-9]/.test(char)) this.#refuse(`uses a backreference inside a character class at position ${String(this.#at)}`);
    if (char === 'p' || char === 'P') this.#refuse(`uses a unicode property escape at position ${String(this.#at)}`);
    const named = classEscape(char);
    if (named !== undefined) { this.#at++; return named; }
    if (char === 'b') { this.#at++; return 8; } // `\b` inside a class is a backspace, as JS reads it
    return this.#escapedCode();
  }
}

/** Thompson's construction: every node becomes instructions that advance together. */
class Program {
  readonly instructions: Instruction[] = [];

  constructor(
    private readonly label: string,
    private readonly source: string,
  ) {}

  #add(instruction: Instruction): number {
    if (this.instructions.length >= PROGRAM_CAP) {
      refuse('unsupported-feature', `${this.label} expands to more than ${String(PROGRAM_CAP)} states, which is larger than this package matches: ${this.source}`);
    }
    this.instructions.push(instruction);
    return this.instructions.length - 1;
  }

  #patch(at: number, instruction: Instruction): void {
    this.instructions[at] = instruction;
  }

  emit(node: Node): void {
    switch (node.kind) {
      case 'empty':
        return;
      case 'char':
        this.#add({ op: 'char', match: node.match });
        return;
      case 'start':
        this.#add({ op: 'start' });
        return;
      case 'end':
        this.#add({ op: 'end' });
        return;
      case 'boundary':
        this.#add({ op: 'boundary', negated: node.negated });
        return;
      case 'concat':
        for (const part of node.parts) this.emit(part);
        return;
      case 'alternate': {
        const ends: number[] = [];
        node.options.forEach((option, index) => {
          const last = index === node.options.length - 1;
          const split = last ? -1 : this.#add({ op: 'split', first: 0, second: 0 });
          const from = this.instructions.length;
          this.emit(option);
          if (!last) {
            ends.push(this.#add({ op: 'jump', to: 0 }));
            this.#patch(split, { op: 'split', first: from, second: this.instructions.length });
          }
        });
        for (const end of ends) this.#patch(end, { op: 'jump', to: this.instructions.length });
        return;
      }
      case 'repeat': {
        // A counted repetition is written out: `a{2,4}` is `aa` then two optional `a`s. The cap
        // above is what keeps the writing-out bounded.
        for (let i = 0; i < node.min; i++) this.emit(node.node);
        if (node.max === Infinity) {
          const split = this.#add({ op: 'split', first: 0, second: 0 });
          const from = this.instructions.length;
          this.emit(node.node);
          this.#add({ op: 'jump', to: split });
          this.#patch(split, { op: 'split', first: from, second: this.instructions.length });
          return;
        }
        const splits: number[] = [];
        for (let i = node.min; i < node.max; i++) {
          splits.push(this.#add({ op: 'split', first: 0, second: 0 }));
          const from = this.instructions.length;
          this.emit(node.node);
          this.#patch(splits[splits.length - 1] ?? 0, { op: 'split', first: from, second: 0 });
        }
        for (const split of splits) {
          const current = this.instructions[split];
          if (current?.op === 'split') this.#patch(split, { op: 'split', first: current.first, second: this.instructions.length });
        }
        return;
      }
    }
  }
}

class CompiledPattern implements LinearPattern {
  readonly #instructions: readonly Instruction[];

  constructor(
    readonly source: string,
    instructions: readonly Instruction[],
  ) {
    this.#instructions = instructions;
  }

  /**
   * Pike's simulation: one pass over the input, carrying the set of states the
   * pattern could be in. Each state joins a position's set at most once, so
   * the work is the pattern's size times the input's length, whatever the
   * pattern. A fresh search is started at every position, which is what an
   * unanchored `test` asks, and the states of all those searches advance
   * together rather than one after another.
   */
  test(input: string): boolean {
    const seen = new Int32Array(this.#instructions.length).fill(-1);
    let generation = 0;

    /** Follows everything that costs no input from `pc`, collecting the states that do. */
    const addThread = (list: number[], start: number, at: number, mark: number): void => {
      const pending = [start];
      while (pending.length > 0) {
        const pc = pending.pop() ?? 0;
        if (seen[pc] === mark) continue;
        seen[pc] = mark;
        const instruction = this.#instructions[pc];
        if (instruction === undefined) continue;
        switch (instruction.op) {
          case 'jump':
            pending.push(instruction.to);
            break;
          case 'split':
            pending.push(instruction.second, instruction.first);
            break;
          case 'start':
            if (at === 0) pending.push(pc + 1);
            break;
          case 'end':
            if (at === input.length) pending.push(pc + 1);
            break;
          case 'boundary': {
            const before = at > 0 && WORD(input.charCodeAt(at - 1));
            const after = at < input.length && WORD(input.charCodeAt(at));
            if ((before !== after) !== instruction.negated) pending.push(pc + 1);
            break;
          }
          case 'char':
          case 'match':
            list.push(pc);
            break;
        }
      }
    };

    let current: number[] = [];
    for (let at = 0; at <= input.length; at++) {
      const carried = current;
      current = [];
      const here = ++generation;
      for (const pc of carried) addThread(current, pc, at, here);
      addThread(current, 0, at, here); // every position is a place the match may begin
      const next: number[] = [];
      const ahead = ++generation;
      for (const pc of current) {
        const instruction = this.#instructions[pc];
        if (instruction?.op === 'match') return true;
        if (instruction?.op === 'char' && at < input.length && instruction.match(input.charCodeAt(at))) {
          addThread(next, pc + 1, at + 1, ahead);
        }
      }
      current = next;
    }
    return false;
  }
}

/**
 * Compiles a pattern, refusing what cannot be matched in one pass. The
 * returned matcher answers the same question `RegExp.prototype.test` answers,
 * for the syntax it accepts, and takes time proportional to the pattern's
 * size times the path's length.
 */
export function compileLinearPattern(pattern: string, label: string): LinearPattern {
  const node = new Parser(pattern, label).parse();
  const program = new Program(label, pattern);
  program.emit(node);
  program.instructions.push({ op: 'match' });
  return new CompiledPattern(pattern, program.instructions);
}
