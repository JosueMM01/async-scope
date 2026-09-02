import { describe, expect, it } from 'vitest';
import { executeProgram } from './execute';

function consoleOutput(source: string): string[] {
  const outcome = executeProgram(source, { language: 'typescript' });
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) return [];
  return outcome.events.filter((event) => event.type === 'console').map((event) => event.text);
}

describe('TypeScript source support', () => {
  it('erases interfaces and annotations before executing the program', () => {
    expect(
      consoleOutput(`
interface Learner { name: string }
const learner: Learner = { name: "Ada" };
console.log(learner.name);
`),
    ).toEqual(['Ada']);
  });

  it('preserves event-loop behavior for typed async functions', () => {
    expect(
      consoleOutput(`
async function run(value: string): Promise<void> {
  console.log("start", value);
  await Promise.resolve();
  console.log("after await");
}
run("typed");
console.log("sync end");
`),
    ).toEqual(['start typed', 'sync end', 'after await']);
  });

  it('does not silently accept TypeScript syntax in JavaScript mode', () => {
    const outcome = executeProgram('const value: number = 1;');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.error.phase).toBe('syntax');
  });

  it('rejects TypeScript constructs that require runtime code generation', () => {
    const outcome = executeProgram('enum Direction { Up, Down }', { language: 'typescript' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.phase).toBe('unsupported');
      expect(outcome.error.message).toContain('enums are not supported');
    }
  });
});
