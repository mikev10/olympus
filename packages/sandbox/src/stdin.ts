import type { Writable } from 'node:stream';

/**
 * The codes a pipe reports when the reader closed it before taking every
 * byte: `EPIPE` everywhere, and `EOF` from a Windows named pipe. A command
 * that exits without reading its input did what it did, and its exit code
 * and output are still its result.
 */
const READER_CLOSED: ReadonlySet<string> = new Set(['EPIPE', 'EOF']);

/**
 * Writes `text` to a child's standard input and closes it (ExecOptions.stdin).
 * Any failure other than the reader having closed the pipe is handed to
 * `onFailure`: the bytes did not arrive, and a command that ran without its
 * input must be refused rather than reported (I5).
 */
export function writeStdin(stream: Writable | null, text: string, onFailure: (error: Error) => void): void {
  if (stream === null) {
    onFailure(new Error('standard input was requested but the child has no stdin stream'));
    return;
  }
  stream.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code !== undefined && READER_CLOSED.has(error.code)) return;
    onFailure(error);
  });
  stream.end(text, 'utf8');
}
