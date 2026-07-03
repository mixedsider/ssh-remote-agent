/**
 * Quote an arbitrary string so it is a single, literal POSIX shell word.
 *
 * Uses single-quote wrapping: everything inside single quotes is literal in a
 * POSIX shell, so `$`, backticks, `"`, `;`, spaces, and newlines are all inert.
 * The only character that cannot appear inside single quotes is `'` itself,
 * which is emitted via the standard `'\''` idiom (close quote, escaped quote,
 * reopen quote).
 *
 * This is the safe way to embed a value into a command string that is handed to
 * a shell (e.g. the remote-side `cd '<dir>'`), avoiding injection.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
