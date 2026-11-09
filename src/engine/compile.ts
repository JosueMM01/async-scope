/**
 * Compiles user source code into instrumented, sandbox-ready JavaScript.
 *
 * Pipeline: parse → scan for unsupported features → pass 1 (async lowering)
 * → pass 2 (instrumentation) → regenerate source.
 */
import type * as t from '@babel/types';
import { generate, parse } from './babel';
import { scanForUnsupportedFeatures, UnsupportedFeatureError } from './scan';
import { stripTypeScript } from './stripTypeScript';
import { createTransformContext, transformAsyncFunctions } from './transform/awaitToGenerator';
import { applyInstrumentation } from './transform/instrument';
import type { CompileError, SourceLanguage } from './types';

export type CompileResult = { ok: true; code: string } | { ok: false; error: CompileError };

/** Cleans Babel's " (<line>:<column>)" suffix from parse error messages. */
function cleanSyntaxMessage(message: string): string {
  return message.replace(/\s+\(\d+:\d+\)\s*$/, '');
}

export function compile(source: string, language: SourceLanguage = 'javascript'): CompileResult {
  let ast: t.File;
  try {
    ast = parse(source, {
      sourceType: 'script',
      allowReturnOutsideFunction: true,
      errorRecovery: false,
      plugins: language === 'typescript' ? ['typescript'] : [],
    });
  } catch (error) {
    const err = error as { message?: string; reasonCode?: string; loc?: { line?: number } };
    const moduleSyntax = err.reasonCode === 'ImportOutsideModule';
    const message = moduleSyntax
      ? 'Imports and exports are not supported in the AsyncScope sandbox.'
      : err.reasonCode === 'AwaitNotInAsyncContext'
        ? 'await must be inside an async function. Use async function or (async () => { ... })().'
        : cleanSyntaxMessage(err.message ?? 'Unexpected syntax error');
    return {
      ok: false,
      error: {
        phase: moduleSyntax ? 'unsupported' : 'syntax',
        message,
        line: err.loc?.line ?? null,
      },
    };
  }

  const ctx = createTransformContext();
  try {
    if (language === 'typescript') {
      stripTypeScript(ast);
    }
    scanForUnsupportedFeatures(ast);
    transformAsyncFunctions(ast, ctx);
    applyInstrumentation(ast, ctx);
  } catch (error) {
    if (error instanceof UnsupportedFeatureError) {
      return {
        ok: false,
        error: { phase: 'unsupported', message: error.message, line: error.line },
      };
    }
    const err = error as { message?: string };
    return {
      ok: false,
      error: {
        phase: 'internal',
        message: `Internal compiler error: ${err.message ?? String(error)}`,
        line: null,
      },
    };
  }

  const output = generate(ast, { comments: true, retainLines: false });
  return { ok: true, code: output.code };
}
