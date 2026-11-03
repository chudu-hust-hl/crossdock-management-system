export function hasUniqueSequences(
  entries: ReadonlyArray<{ sequence: number }>,
): boolean {
  return (
    new Set(entries.map((entry) => entry.sequence)).size === entries.length
  );
}
