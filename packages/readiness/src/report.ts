/**
 * A report as a table: the ceiling, the probe that holds it there, and every
 * probe's outcome grouped by pillar (R1 §7). The reason is always one probe,
 * never a pillar and never a score.
 */
import type { ProbeEvidence, ReadinessReport } from './types.js';

export function renderReport(report: ReadinessReport): string {
  const { ceiling } = report;
  const held = ceiling.heldBy;
  const reason = held.kind === 'scan-limit'
    ? 'every ceiling-bearing probe is supported, and no scan grants L3'
    : `held by ${held.probe}: ${report.probes.find((p) => p.probe === held.probe)?.detail ?? 'no result recorded'}`;
  const lines = [`Readiness ceiling L${String(ceiling.level)} at ${report.commit}, ${reason}`, ''];
  const rows = report.probes.map((p) => [p.pillar, p.probe, p.ceilingBearing ? 'yes' : 'no', p.outcome, how(p.evidence), p.detail]);
  const header = ['pillar', 'probe', 'ceiling', 'outcome', 'how', 'detail'];
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (i === header.length - 1 ? 0 : (r[i] ?? '').length))));
  const line = (cells: readonly string[]) => cells.map((c, i) => (i === cells.length - 1 ? c : c.padEnd(widths[i] ?? 0))).join('  ');
  lines.push(line(header));
  for (const row of rows) lines.push(line(row));
  for (const s of report.skipped) lines.push(`skipped: ${s}`);
  return lines.join('\n');
}

function how(evidence: ProbeEvidence): string {
  switch (evidence.via) {
    case 'executed': {
      const run = evidence.run.kind === 'exited' ? `exit ${String(evidence.run.exitCode)}` : 'stopped';
      return `${evidence.argv.join(' ')} (${run}, ${String(Math.round(evidence.run.durationMs))}ms)`;
    }
    case 'static':
      return `read: ${evidence.read}`;
    case 'checker':
      return `checker: ${evidence.checker}`;
    case 'not-run':
      return `not run: ${evidence.because}`;
  }
}
