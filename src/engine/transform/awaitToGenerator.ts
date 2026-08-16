/**
 * Pass 1 of the instrumentation pipeline: rewrite every async function into a
 * plain generator driven by the AsyncScope runtime.
 *
 * Why: native async functions are driven by the engine's own microtask queue,
 * which we cannot observe or schedule deterministically. By lowering
 * `async`/`await` into `__AS__.a2g(function* …)` + `yield`, every continuation
 * flows through the SandboxPromise implementation and the virtual scheduler,
 * where it becomes a visible, recordable microtask.
 *
 * Shapes produced:
 *
 *   async function f(a) { …await x… }
 *     → function f(a) { return __AS__.a2g(f$asgen, this, arguments, "f"); }
 *       function* f$asgen(a) { …yield x… }
 *
 *   async (a) => body
 *     → (...__asArgs) => __AS__.a2g(function* (a) { …body… }, this, __asArgs, "name")
 *
 *   async method(a) { … }
 *     → method(a) { return __AS__.a2g(function* (a) { … }, this, arguments, "method"); }
 */
import * as t from '@babel/types';
import type { NodePath } from '@babel/traverse';
import { traverse } from '../babel';

export interface TransformContext {
  /** Display name assigned to a transformed node (used by pass 2). */
  displayNames: WeakMap<t.Node, string>;
  /** Nodes that pass 2 must not instrument (synthetic wrappers). */
  skipInstrument: WeakSet<t.Node>;
  genCounter: { n: number };
}

export function createTransformContext(): TransformContext {
  return {
    displayNames: new WeakMap(),
    skipInstrument: new WeakSet(),
    genCounter: { n: 0 },
  };
}

const AS = '__AS__';
const ARGS = '__asArgs';

function asCall(name: string, args: t.Expression[]): t.CallExpression {
  return t.callExpression(t.memberExpression(t.identifier(AS), t.identifier(name)), args);
}

/** Builds `__AS__.a2g(genFn, thisArg, args, "displayName")`. */
function buildA2gCall(
  genFn: t.Expression,
  thisArg: t.Expression,
  argsExpr: t.Expression,
  displayName: string,
): t.CallExpression {
  return asCall('a2g', [genFn, thisArg, argsExpr, t.stringLiteral(displayName)]);
}

/** Best-effort static name for a function from its syntactic position. */
function inferStaticName(path: NodePath<t.Function>): string | null {
  const { parentPath, node } = path;
  if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression') {
    if (node.id) return node.id.name;
  }
  if (!parentPath) return null;
  const parent = parentPath.node;
  switch (parent.type) {
    case 'VariableDeclarator':
      return parent.id.type === 'Identifier' ? parent.id.name : null;
    case 'AssignmentExpression':
      return parent.left.type === 'Identifier' ? parent.left.name : null;
    case 'ObjectProperty':
    case 'ObjectMethod':
      return parent.key.type === 'Identifier'
        ? parent.key.name
        : parent.key.type === 'StringLiteral'
          ? parent.key.value
          : null;
    case 'ClassMethod':
    case 'ClassPrivateMethod':
    case 'ClassProperty':
    case 'ClassAccessorProperty':
      return parent.key.type === 'Identifier'
        ? parent.key.name
        : parent.key.type === 'PrivateName'
          ? `#${parent.key.id.name}`
          : null;
    default:
      return null;
  }
}

function cloneParams(params: readonly t.LVal[]): t.LVal[] {
  return params.map((p) => t.cloneNode(p, true));
}

function uniqueGenName(base: string, ctx: TransformContext): t.Identifier {
  const sanitized = base.replace(/[^A-Za-z0-9_$]/g, '_') || 'anon';
  return t.identifier(`${sanitized}$asgen${++ctx.genCounter.n}`);
}

/** Normalizes an async function body into a block body for the generator. */
function generatorBody(body: t.BlockStatement | t.Expression): t.BlockStatement {
  return body.type === 'BlockStatement'
    ? body
    : t.blockStatement([t.returnStatement(body)]);
}

export function transformAsyncFunctions(ast: t.Node, ctx: TransformContext): void {
  traverse(
    ast,
    {
      'ArrowFunctionExpression|FunctionDeclaration|FunctionExpression|ObjectMethod|ClassMethod|ClassPrivateMethod'(
        path,
        state,
      ) {
        const tctx = state as TransformContext;
        const node = path.node as t.Function;
        if (!node.async || node.generator) return;

        const displayName = inferStaticName(path) ?? '(anonymous)';

        switch (node.type) {
          case 'FunctionDeclaration': {
            const originalId = node.id;
            const genId = uniqueGenName(originalId?.name ?? 'anon', tctx);
            const genDecl = t.functionDeclaration(
              genId,
              node.params,
              node.body as t.BlockStatement,
              /* generator */ true,
              /* async */ false,
            );
            tctx.displayNames.set(genDecl, displayName);
            const wrapper = t.functionDeclaration(
              originalId ? t.cloneNode(originalId) : t.identifier(`__asAnonFn${++tctx.genCounter.n}`),
              cloneParams(node.params),
              t.blockStatement([
                t.returnStatement(
                  buildA2gCall(genId, t.thisExpression(), t.identifier('arguments'), displayName),
                ),
              ]),
              false,
              false,
            );
            tctx.skipInstrument.add(wrapper);
            path.replaceWithMultiple([wrapper, genDecl]);
            break;
          }
          case 'FunctionExpression': {
            const gen = t.functionExpression(
              node.id ? uniqueGenName(node.id.name, tctx) : null,
              node.params,
              node.body as t.BlockStatement,
              true,
              false,
            );
            tctx.displayNames.set(gen, displayName);
            const wrapper = t.functionExpression(
              node.id ? t.cloneNode(node.id) : null,
              cloneParams(node.params),
              t.blockStatement([
                t.returnStatement(
                  buildA2gCall(gen, t.thisExpression(), t.identifier('arguments'), displayName),
                ),
              ]),
              false,
              false,
            );
            tctx.skipInstrument.add(wrapper);
            path.replaceWith(wrapper);
            break;
          }
          case 'ArrowFunctionExpression': {
            const gen = t.functionExpression(
              null,
              node.params,
              generatorBody(node.body),
              true,
              false,
            );
            tctx.displayNames.set(gen, displayName);
            const wrapper = t.arrowFunctionExpression(
              [t.restElement(t.identifier(ARGS))],
              buildA2gCall(gen, t.thisExpression(), t.identifier(ARGS), displayName),
              false,
            );
            tctx.skipInstrument.add(wrapper);
            path.replaceWith(wrapper);
            break;
          }
          case 'ObjectMethod':
          case 'ClassMethod':
          case 'ClassPrivateMethod': {
            const method = node as t.ObjectMethod | t.ClassMethod | t.ClassPrivateMethod;
            const gen = t.functionExpression(null, method.params, method.body, true, false);
            tctx.displayNames.set(gen, displayName);
            method.params = cloneParams(method.params);
            method.body = t.blockStatement([
              t.returnStatement(
                buildA2gCall(gen, t.thisExpression(), t.identifier('arguments'), displayName),
              ),
            ]);
            method.async = false;
            break;
          }
        }
      },
      AwaitExpression(path) {
        path.replaceWith(t.yieldExpression(path.node.argument, false));
      },
    },
    undefined,
    ctx,
  );
}
