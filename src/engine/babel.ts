/**
 * Interop helpers for the Babel packages used by the engine.
 *
 * The engine only needs the parser, traverser and code generator — never
 * @babel/core — so it stays small enough to run inside the sandbox worker.
 */
import _traverse from '@babel/traverse';
import _generate from '@babel/generator';
import { parse as babelParse } from '@babel/parser';
import type * as TraverseNS from '@babel/traverse';
import type * as GenerateNS from '@babel/generator';
import type * as ParserNS from '@babel/parser';

type MaybeDefault = { default?: unknown };

export const traverse: typeof TraverseNS.default = (
  (_traverse as unknown as MaybeDefault).default ?? _traverse
) as typeof TraverseNS.default;

export const generate: typeof GenerateNS.default = (
  (_generate as unknown as MaybeDefault).default ?? _generate
) as typeof GenerateNS.default;

export const parse: typeof ParserNS.parse = babelParse;
