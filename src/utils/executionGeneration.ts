let generation = 0;

export function acceptEditorExecution(): number {
  generation += 1;
  return generation;
}

export function getEditorExecutionGeneration(): number {
  return generation;
}
