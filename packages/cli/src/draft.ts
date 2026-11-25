/**
 * A draft as a person reads it before deciding it (R55, #175): the answer of
 * `GET /runs/:id/draft`, printed as text. The files are a model's, so nothing
 * of them reaches the terminal as written: a character that moves the cursor,
 * hides text, or reorders a line is printed as an escape, and every line of a
 * file sits behind a margin, so it cannot pass as one of this command's own
 * lines. What a person reads is then what the hash they approve covers.
 */
import type { DraftView } from '@olympus-ai/api';

/**
 * Whether a character moves the cursor, hides, or reorders text on a
 * terminal: the control characters, the zero-width and direction marks, and
 * the direction overrides and isolates.
 */
function unprintable(code: number): boolean {
  return code < 0x20 || (code >= 0x7f && code <= 0x9f) || (code >= 0x200b && code <= 0x200f) || (code >= 0x202a && code <= 0x202e) || (code >= 0x2060 && code <= 0x2069) || code === 0xfeff;
}

/** `text` with every unprintable character but those in `keep` written as a `\u{..}` escape. */
export function visible(text: string, keep = ''): string {
  let out = '';
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    out += unprintable(code) && !keep.includes(char) ? `\\u{${code.toString(16)}}` : char;
  }
  return out;
}

/** Whether a response body has a draft's shape; anything else is reported, not printed as one. */
export function isDraftView(value: unknown): value is DraftView {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { [K in keyof DraftView]?: unknown };
  const draft = v.draft as { sha256?: unknown; attempt?: unknown } | null | undefined;
  const questions = v.questions as { kind?: unknown } | null | undefined;
  return typeof v.runId === 'string' && typeof v.station === 'string'
    && typeof draft?.sha256 === 'string' && typeof draft.attempt === 'number'
    && (v.awaiting === null || typeof v.awaiting === 'string')
    && Array.isArray(v.files) && v.files.every((f: { path?: unknown; sha256?: unknown; base64?: unknown } | null) => typeof f?.path === 'string' && typeof f.sha256 === 'string' && typeof f.base64 === 'string')
    && (questions?.kind === 'none' || questions?.kind === 'unreadable' || questions?.kind === 'read');
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
    lines.push('', `file ${visible(file.path)} (${String(bytes.length)} bytes, sha256 ${visible(file.sha256)})`);
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      lines.push('| (not UTF-8 text; not shown)');
      continue;
    }
    if (text === '') {
      lines.push('| (empty)');
      continue;
    }
    const content = text.split(/\r?\n/u);
    if (content.at(-1) === '') content.pop();
    for (const line of content) lines.push(`| ${visible(line, '\t')}`);
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
