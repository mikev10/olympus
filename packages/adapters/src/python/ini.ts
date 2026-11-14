/**
 * The INI reading pytest does through iniconfig (2.x `_parse.py`), ported
 * line for line, and the two pattern languages pytest matches with:
 * `fnmatch` for names and paths, and `shlex.split` for an `args` setting.
 * Ported rather than run, since nothing on the host may start Python (I1).
 */
import { refuse } from '../refusal.js';

const COMMENT = '#;';

/** Sections by name, each key's value its lines joined by `\n`, as iniconfig yields them. */
export type Ini = ReadonlyMap<string, ReadonlyMap<string, string>>;

export function parseIni(text: string, path: string): Ini {
  const sections = new Map<string, Map<string, string[]>>();
  let section: string | null = null;
  let last: string[] | null = null;
  const lines = text.replace(/^\uFEFF/u, '').split(/\r\n|\n|\r/u);
  lines.forEach((raw, index) => {
    const at = `${path}:${String(index + 1)}`;
    const stripped = raw.trimStart();
    let line = stripped !== '' && COMMENT.includes(stripped[0] ?? '') ? '' : raw.trimEnd();
    if (line === '') return;
    if (line.startsWith('[')) {
      let head = line;
      for (const c of COMMENT) head = (head.split(c)[0] ?? '').trimEnd();
      if (head.endsWith(']')) {
        const name = head.slice(1, -1);
        if (name === '') refuse('unparseable', `${at}: empty section name`);
        if (sections.has(name)) refuse('unparseable', `${at}: duplicate section ${name}`);
        sections.set(name, new Map());
        section = name;
        last = null;
        return;
      }
      line = ` ${line.trim()}`; // iniconfig reads a bracket line that is no header as a continuation
    }
    if (!/^\s/u.test(line)) {
      let split = line.indexOf('=');
      if (split === -1 || line.slice(0, split).includes(':')) split = line.indexOf(':');
      if (split === -1) refuse('unparseable', `${at}: unexpected line`);
      if (section === null) refuse('unparseable', `${at}: no section header defined`);
      const name = line.slice(0, split).trim();
      const value = line.slice(split + 1).trim();
      const keys = sections.get(section);
      if (keys === undefined) return;
      if (keys.has(name)) refuse('unparseable', `${at}: duplicate name ${name}`);
      last = value === '' ? [] : [value];
      keys.set(name, last);
      return;
    }
    if (last === null) refuse('unparseable', `${at}: unexpected value continuation`);
    last.push(line.trim());
  });
  return new Map([...sections].map(([name, keys]) => [name, new Map([...keys].map(([k, v]) => [k, v.join('\n')]))]));
}

/**
 * `fnmatch.fnmatch` on a POSIX host, where it is case-sensitive: `*` matches
 * anything, `/` included; `?` one character; `[seq]` and `[!seq]` a class.
 */
export function fnmatch(name: string, pattern: string): boolean {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] ?? '';
    if (c === '*') source += '[\\s\\S]*';
    else if (c === '?') source += '[\\s\\S]';
    else if (c === '[') {
      const close = pattern.indexOf(']', i + 2);
      if (close === -1) source += '\\[';
      else {
        let body = pattern.slice(i + 1, close);
        const negated = body.startsWith('!');
        if (negated) body = body.slice(1);
        source += `[${negated ? '^' : ''}${body.replace(/[\\\]^]/gu, (m) => `\\${m}`)}]`;
        i = close;
      }
    } else source += c.replace(/[.*+?^${}()|[\]\\/]/gu, (m) => `\\${m}`);
  }
  return new RegExp(`^${source}$`, 'u').test(name);
}

/**
 * `shlex.split` for the values pytest reads as `args`, refused where the
 * value quotes or escapes, whose splitting the parse would have to model
 * exactly to name the same paths pytest does.
 */
export function splitArgs(value: string, label: string): string[] {
  if (/["'\\]/u.test(value)) refuse('unresolvable-config', `${label} quotes or escapes a value, which is not read statically`);
  return value.split(/\s+/u).filter((part) => part !== '');
}
