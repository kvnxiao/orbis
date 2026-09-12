/** Fence user text without allowing embedded fences to terminate the objective block. */
export function fencedObjective(objective: string): string {
  let fenceLength = 3;
  for (const match of objective.matchAll(/`+/gu)) {
    fenceLength = Math.max(fenceLength, match[0].length + 1);
  }
  const fence = "`".repeat(fenceLength);
  return `${fence}\n${objective}\n${fence}`;
}
