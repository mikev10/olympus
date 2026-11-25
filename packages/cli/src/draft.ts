/**
 * A draft as a person reads it before deciding it (R55, #175): the answer of
 * `GET /runs/:id/draft`, printed as text. The files are a model's, so nothing
 * of them reaches the terminal as written, and what is printed for a file
 * stands for exactly one sequence of bytes:
 *
 * - every character that is not a visible one is printed as a `\u{..}`
 *   escape, and a backslash as two, so an escape on the screen is never the
 *   file's own text spelling one;
 * - a file that is not UTF-8 is printed byte for byte, never withheld;
 * - a byte-order mark and a carriage return are characters like any other,
 *   and a file that does not end in a newline says so;
 * - every line of a file sits behind a `| ` margin, and the command's own
 *   lines never do, so a file cannot print one of them.
 *
 * What a person reads is then what the hash they approve covers.
 */
import type { DraftView } from '@olympus-ai/api';

/**
 * A character that is not a visible one: a control, a format character (the
 * zero-width and direction marks among them), a line or paragraph separator,
 * a private-use or unassigned code point, or a lone surrogate.
 */
const UNPRINTABLE = /[\p{C}\p{Zl}\p{Zp}]/u;

/**
 * `text` with a backslash doubled and every unprintable character but those
 * in `keep` written as a `\u{..}` escape. Distinct texts print distinctly.
 */
export function visible(text: string, keep = ''): string {
  let out = '';
  for (const char of text) {
    if (char === '\\') out += '\\\\';
    else if (UNPRINTABLE.test(char) && !keep.includes(char)) out += `\\u{${(char.codePointAt(0) ?? 0).toString(16)}}`;
    else out += char;
  }
  return out;
}

/** Bytes that are not UTF-8, as lines: printable ASCII as itself, a backslash doubled, every other byte as `\x{..}`. */
function byteLines(bytes: Uint8Array): string[] {
  const lines: string[] = [];
  let line = '';
  for (const byte of bytes) {
    if (byte === 0x0a) {
      lines.push(line);
      line = '';
    } else if (byte === 0x5c) line += '\\\\';
    else if (byte >= 0x20 && byte <= 0x7e) line += String.fromCharCode(byte);
    else line += `\\x{${byte.toString(16).padStart(2, '0')}}`;
  }
  lines.push(line);
  return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isQuestions(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === 'none' || value.kind === 'unreadable') return true;
  return value.kind === 'read'
    && Array.isArray(value.openQuestions) && value.openQuestions.every((q) => typeof q === 'string')
    && Array.isArray(value.assumptions) && value.assumptions.every((a) => isRecord(a) && typeof a.point === 'string' && typeof a.chose === 'string');
}

/** Whether a response body has a draft's shape, every field `draftLines` reads included; anything else is reported, not printed as one. */
export function isDraftView(value: unknown): value is DraftView {
  if (!isRecord(value)) return false;
  const { draft, files } = value;
  return typeof value.runId === 'string' && typeof value.station === 'string'
    && isRecord(draft) && typeof draft.sha256 === 'string' && typeof draft.attempt === 'number'
    && (value.awaiting === null || typeof value.awaiting === 'string')
    && Array.isArray(files) && files.every((f) => isRecord(f) && typeof f.path === 'string' && typeof f.sha256 === 'string' && typeof f.base64 === 'string')
    && isQuestions(value.questions);
}

/** One file's lines: each line of content behind the margin, and the command's own notes about it without one. */
function fileLines(bytes: Uint8Array): string[] {
  if (bytes.length === 0) return ['  (empty file)'];
  let content: string[];
  const before: string[] = [];
  const after: string[] = [];
  try {
    // The byte-order mark is kept, so it is printed as the character it is.
    content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes).split('\n').map((line) => visible(line, '\t'));
  } catch {
    before.push('  (not UTF-8: every byte outside printable ASCII is shown as \\x{..})');
    content = byteLines(bytes);
  }
  // A final newline ends the last line; without one, the last line is said to be unended.
  if (content.at(-1) === '') content.pop();
  else after.push('  (no newline at end of file)');
  return [...before, ...content.map((line) => `| ${line}`), ...after];
}

/**
 * The lines the command prints: the hash and whether the draft is waiting,
 * each file behind a `| ` margin, then the questions part as the runtime
 * read it. `command` is the executable's name, for the approval it suggests.
 */
export function draftLines(view: DraftView, command: string): string[] {
  const run = visible(view.runId);
  const lines = [
    `run ${run}: the ${visible(view.station)} draft, attempt ${String(view.draft.attempt)}`,
    `hash ${visible(view.draft.sha256)}`,
    view.awaiting === null
      ? 'not waiting for a decision: status names the draft that is, if one is'
      : `waiting for a decision at ${visible(view.awaiting)}; to approve it: ${command} approve ${run} ${visible(view.awaiting)} --draft ${visible(view.draft.sha256)}`,
  ];
  for (const file of view.files) {
    const bytes = Buffer.from(file.base64, 'base64');
    lines.push('', `file ${visible(file.path)} (${String(bytes.length)} bytes, sha256 ${visible(file.sha256)})`, ...fileLines(bytes));
  }
  lines.push('');
  const { questions } = view;
  if (questions.kind === 'none') {
    lines.push('questions: this draft has no questions part');
  } else if (questions.kind === 'unreadable') {
    lines.push('questions: the questions file could not be read as a questions part; it is printed above as written');
  } else {
    lines.push(`open questions: ${questions.openQuestions.length === 0 ? 'none' : String(questions.openQuestions.length)}`);
    questions.openQuestions.forEach((question, i) => lines.push(`  ${String(i + 1)}. ${visible(question)}`));
    lines.push(`assumptions: ${questions.assumptions.length === 0 ? 'none' : String(questions.assumptions.length)}`);
    questions.assumptions.forEach((a, i) => lines.push(`  ${String(i + 1)}. ${visible(a.point)}`, `     chose: ${visible(a.chose)}`));
  }
  return lines;
}
