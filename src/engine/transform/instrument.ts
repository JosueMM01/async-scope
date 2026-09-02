/**
 * Pass 2 of the instrumentation pipeline.
 *
 * Injects the runtime calls that make execution observable:
 *
 * - every function body:  __AS__.enter(name) / try { … } finally { __AS__.exit() }
 * - every `yield` (i.e. a lowered `await`):
 *     __AS__.afterYield(yield __AS__.beforeYield(expr, name), name)
 *   so suspension and resumption pop/push the call-stack frame visibly.
 * - every loop body:      __AS__.tick()  (execution budget guard, also covers
 *                         loops whose bodies contain no statements)
 * - every statement:      __AS__.loc(line) (current-line tracking + budget)
 * - the whole program:    global frame enter/exit in try/finally
 */
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import { traverse } from '../babel';
import type { TransformContext } from './awaitToGenerator';

const AS = '__AS__';

/** Marker so our own visitors ignore injected statements. */
const INJECTED = new WeakSet<t.Node>();

/** Statements that already received a `__AS__.loc` prefix. */
const LOC_DONE = new WeakSet<t.Node>();

/** Functions already wrapped (guards against re-queued traversals). */
const FUNCTION_DONE = new WeakSet<t.Node>();

/** Yields already rewritten (guards against re-queued traversals). */
const YIELD_DONE = new WeakSet<t.Node>();

/** Loops already ticked. */
const LOOP_DONE = new WeakSet<t.Node>();

function asCallStmt(name: string, args: t.Expression[]): t.ExpressionStatement {
  return t.expressionStatement(
    t.callExpression(t.memberExpression(t.identifier(AS), t.identifier(name)), args),
  );
}

function lineArg(line: number | null): t.Expression {
  return line === null ? t.nullLiteral() : t.numericLiteral(line);
}

function injected(stmt: t.Statement): t.Statement {
  INJECTED.add(stmt);
  return stmt;
}

function isDirective(node: t.Statement): boolean {
  return (
    node.type === 'ExpressionStatement' &&
    typeof (node as t.ExpressionStatement & { directive?: unknown }).directive === 'string'
  );
}

/** Splits a statement list into [directive prologue, rest]. */
function splitDirectives(stmts: t.Statement[]): [t.Statement[], t.Statement[]] {
  let i = 0;
  while (i < stmts.length && isDirective(stmts[i]!)) i++;
  return [stmts.slice(0, i), stmts.slice(i)];
}

/** Resolves the display name used for a function's stack frame. */
function resolveFunctionName(path: NodePath<t.Function>, ctx: TransformContext): string {
  const node = path.node;
  const known = ctx.displayNames.get(node);
  if (known) return known;
  if ((node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') && node.id) {
    return node.id.name;
  }
  if (
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  ) {
    if (node.key.type === 'Identifier') return node.key.name;
    if (node.key.type === 'PrivateName') return `#${node.key.id.name}`;
    if (node.key.type === 'StringLiteral') return node.key.value;
  }
  const parent = path.parentPath?.node;
  if (parent) {
    switch (parent.type) {
      case 'VariableDeclarator':
        if (parent.id.type === 'Identifier') return parent.id.name;
        break;
      case 'AssignmentExpression':
        if (parent.left.type === 'Identifier') return parent.left.name;
        break;
      case 'ObjectProperty':
      case 'ObjectMethod':
        if (parent.key.type === 'Identifier') return parent.key.name;
        break;
      case 'ClassMethod':
      case 'ClassProperty':
        if (parent.key.type === 'Identifier') return parent.key.name;
        break;
    }
  }
  return '(anonymous)';
}

/** Wraps `stmts` with an enter/exit pair, keeping directives first. */
function wrapFunctionBody(stmts: t.Statement[], name: string, line: number | null): t.Statement[] {
  const [directives, rest] = splitDirectives(stmts);
  return [
    ...directives,
    injected(asCallStmt('enter', [t.stringLiteral(name), lineArg(line)])),
    t.tryStatement(
      t.blockStatement(rest),
      null,
      t.blockStatement([injected(asCallStmt('exit', []))]),
    ),
  ];
}

export function applyInstrumentation(ast: t.Node, ctx: TransformContext): void {
  traverse(
    ast,
    {
      Function: {
        enter(path, state) {
          const tctx = state as TransformContext;
          const node = path.node;
          if (tctx.skipInstrument.has(node) || FUNCTION_DONE.has(node)) return;
          FUNCTION_DONE.add(node);

          // Normalize expression-bodied arrows to block bodies.
          if (node.type === 'ArrowFunctionExpression' && node.body.type !== 'BlockStatement') {
            node.body = t.blockStatement([t.returnStatement(node.body)]);
          }
          const body = node.body as t.BlockStatement;
          const name = resolveFunctionName(path, tctx);
          const line = node.loc?.start.line ?? null;
          body.body = wrapFunctionBody(body.body, name, line);
        },
      },
      YieldExpression: {
        enter(path, state) {
          const tctx = state as TransformContext;
          const node = path.node;
          if (YIELD_DONE.has(node)) return;
          YIELD_DONE.add(node);
          const fnPath = path.getFunctionParent();
          if (!fnPath || tctx.skipInstrument.has(fnPath.node)) return;
          const name = resolveFunctionName(fnPath, tctx);
          const line = lineArg(path.node.loc?.start.line ?? null);

          // __AS__.beforeYield(expr) pops the frame and forwards the value.
          // The argument is evaluated while the frame is still on the stack,
          // matching real `await` semantics.
          const before = t.callExpression(
            t.memberExpression(t.identifier(AS), t.identifier('beforeYield')),
            [path.node.argument ?? t.identifier('undefined'), t.stringLiteral(name), line],
          );
          // __AS__.afterYield(yield …) re-pushes the frame and returns the
          // value the runtime resumed the generator with.
          const resumed = t.yieldExpression(before, false);
          YIELD_DONE.add(resumed); // the replacement is re-traversed
          path.replaceWith(
            t.callExpression(t.memberExpression(t.identifier(AS), t.identifier('afterYield')), [
              resumed,
              t.stringLiteral(name),
              line,
            ]),
          );
        },
      },
      Loop: {
        enter(path) {
          const node = path.node as t.Loop;
          if (LOOP_DONE.has(node)) return;
          LOOP_DONE.add(node);
          if (node.body.type !== 'BlockStatement') {
            node.body = t.blockStatement([node.body]);
          }
          const line = node.loc?.start.line ?? null;
          (node.body as t.BlockStatement).body.unshift(
            injected(asCallStmt('tick', [lineArg(line)])),
          );
        },
      },
      Statement: {
        enter(path) {
          const node = path.node as t.Statement;
          if (
            INJECTED.has(node) ||
            LOC_DONE.has(node) ||
            node.type === 'BlockStatement' ||
            node.type === 'EmptyStatement' ||
            isDirective(node)
          ) {
            return;
          }
          const line = node.loc?.start.line ?? null;
          if (line === null) return;
          LOC_DONE.add(node);
          const locStmt = injected(asCallStmt('loc', [t.numericLiteral(line)]));

          if (Array.isArray(path.container)) {
            // Program, BlockStatement or SwitchCase statement lists.
            path.insertBefore(locStmt);
          } else {
            // Single-statement positions (if/else/label/with bodies, loop
            // bodies…): wrap in a block. Blocks are transparent here because
            // single-statement positions cannot contain lexical declarations.
            path.replaceWith(t.blockStatement([locStmt, node]));
          }
        },
      },
      Program: {
        exit(path) {
          const program = path.node;
          const [directives, rest] = splitDirectives(program.body);
          program.body = [
            ...directives,
            injected(asCallStmt('enter', [t.stringLiteral('(global)'), t.numericLiteral(1)])),
            t.tryStatement(
              t.blockStatement(rest),
              null,
              t.blockStatement([injected(asCallStmt('exit', []))]),
            ),
          ];
        },
      },
    },
    undefined,
    ctx,
  );
}
