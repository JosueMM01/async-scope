/**
 * Removes TypeScript's type-only syntax from an already parsed Babel AST.
 *
 * This deliberately supports the erasable TypeScript subset used for runtime
 * learning. Constructs that emit JavaScript (enums, namespaces and parameter
 * properties) are rejected instead of pretending they are type-only.
 */
import type * as t from '@babel/types';
import { traverse } from './babel';
import { UnsupportedFeatureError } from './scan';

function unsupported(message: string, node: t.Node): never {
  throw new UnsupportedFeatureError(message, node.loc?.start.line ?? null);
}

export function stripTypeScript(ast: t.Node): void {
  traverse(ast, {
    TSInterfaceDeclaration(path) {
      path.remove();
    },
    TSTypeAliasDeclaration(path) {
      path.remove();
    },
    TSDeclareFunction(path) {
      path.remove();
    },
    VariableDeclaration(path) {
      if (path.node.declare) path.remove();
    },
    Class(path) {
      const node = path.node;
      const typedNode = node as typeof node & {
        declare?: boolean | null;
        abstract?: boolean | null;
      };
      if (typedNode.declare) {
        path.remove();
        return;
      }
      node.typeParameters = null;
      node.superTypeArguments = null;
      node.implements = null;
      typedNode.abstract = null;
    },
    Function(path) {
      const node = path.node;
      node.returnType = null;
      node.typeParameters = null;
    },
    Identifier(path) {
      path.node.typeAnnotation = null;
      path.node.optional = null;
    },
    RestElement(path) {
      path.node.typeAnnotation = null;
    },
    ObjectPattern(path) {
      path.node.typeAnnotation = null;
    },
    ArrayPattern(path) {
      path.node.typeAnnotation = null;
    },
    ClassProperty(path) {
      const node = path.node;
      if (node.declare) {
        path.remove();
        return;
      }
      node.typeAnnotation = null;
      node.definite = null;
      node.abstract = null;
      node.optional = null;
      node.readonly = null;
      node.accessibility = null;
      node.override = null;
    },
    ClassPrivateProperty(path) {
      path.node.typeAnnotation = null;
      path.node.definite = null;
      path.node.optional = null;
      path.node.readonly = null;
    },
    'TSAsExpression|TSSatisfiesExpression|TSTypeAssertion|TSNonNullExpression|TSInstantiationExpression'(
      path,
    ) {
      path.replaceWith(path.node.expression);
    },
    CallExpression(path) {
      path.node.typeArguments = null;
    },
    OptionalCallExpression(path) {
      path.node.typeArguments = null;
    },
    NewExpression(path) {
      path.node.typeArguments = null;
    },
    TSParameterProperty(path) {
      unsupported('TypeScript parameter properties are not supported', path.node);
    },
    TSEnumDeclaration(path) {
      unsupported('TypeScript enums are not supported; use a const object instead', path.node);
    },
    TSModuleDeclaration(path) {
      unsupported('TypeScript namespaces are not supported', path.node);
    },
    TSImportEqualsDeclaration(path) {
      unsupported('TypeScript import aliases are not supported', path.node);
    },
    TSExportAssignment(path) {
      unsupported('TypeScript export assignments are not supported', path.node);
    },
  });
}
