/**
 * CodeMirror 6 editor with a Monokai Night theme, line numbers and an
 * "executing line" highlight driven by the playback cursor.
 */
import { useEffect, useRef } from 'react';
import {
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet, keymap, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  HighlightStyle,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { javascript } from '@codemirror/lang-javascript';
import { tags as t } from '@lezer/highlight';
import type { SourceLanguage } from '../engine/types';

export interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** 1-based source line currently executing, or null. */
  activeLine: number | null;
  language: SourceLanguage;
  readOnly?: boolean;
  ariaLabel?: string;
}

const setActiveLineEffect = StateEffect.define<number | null>();
const languageCompartment = new Compartment();

function languageExtension(language: SourceLanguage): Extension {
  return javascript({ jsx: false, typescript: language === 'typescript' });
}

const activeLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setActiveLineEffect)) {
        if (effect.value == null) {
          value = Decoration.none;
        } else {
          const lineNumber = Math.min(Math.max(1, effect.value), tr.state.doc.lines);
          const line = tr.state.doc.line(lineNumber);
          value = Decoration.set([Decoration.line({ class: 'as-active-line' }).range(line.from)]);
        }
      }
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const monokaiHighlight = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.comment, t.meta], class: 'tok-comment' },
    { tag: [t.keyword, t.moduleKeyword, t.controlKeyword], class: 'tok-keyword' },
    { tag: [t.string, t.special(t.string)], class: 'tok-string' },
    { tag: [t.number, t.bool, t.null], class: 'tok-number' },
    { tag: [t.function(t.variableName), t.function(t.propertyName)], class: 'tok-function' },
    { tag: t.definition(t.variableName), class: 'tok-def' },
    { tag: [t.variableName, t.propertyName], class: 'tok-var' },
    { tag: [t.operator, t.punctuation, t.separator, t.bracket], class: 'tok-punct' },
    { tag: [t.className, t.typeName], class: 'tok-type' },
    { tag: t.tagName, class: 'tok-tag' },
    { tag: t.invalid, class: 'tok-invalid' },
  ]),
);

const editorTheme: Extension = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13.5px',
    backgroundColor: 'transparent',
    color: 'var(--as-fg)',
  },
  '.cm-scroller': {
    fontFamily:
      "ui-monospace, 'Cascadia Code', 'SF Mono', 'JetBrains Mono', Consolas, 'Courier New', monospace",
    lineHeight: '1.6',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--as-muted)',
    border: 'none',
    opacity: 0.7,
  },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--as-fg)' },
  '.cm-content': { caretColor: 'var(--as-yellow)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor': { borderLeftColor: 'var(--as-yellow)', borderLeftWidth: '2px' },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, var(--as-purple) 30%, transparent)',
  },
  '.as-active-line': {
    backgroundColor: 'color-mix(in srgb, var(--as-yellow) 12%, transparent)',
    borderLeft: '2px solid var(--as-yellow)',
  },
  '.tok-comment': { color: 'var(--as-muted)', fontStyle: 'italic' },
  '.tok-keyword': { color: 'var(--as-pink)' },
  '.tok-string': { color: 'var(--as-yellow)' },
  '.tok-number': { color: 'var(--as-purple)' },
  '.tok-function': { color: 'var(--as-green)' },
  '.tok-def': { color: 'var(--as-cyan)' },
  '.tok-var': { color: 'var(--as-fg)' },
  '.tok-punct': { color: 'var(--as-fg)', opacity: 0.85 },
  '.tok-type': { color: 'var(--as-cyan)' },
  '.tok-tag': { color: 'var(--as-pink)' },
  '.tok-invalid': { color: 'var(--as-pink)', textDecoration: 'underline wavy' },
});

export function CodeEditor({
  value,
  onChange,
  activeLine,
  language,
  readOnly = false,
  ariaLabel,
}: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          indentUnit.of('  '),
          bracketMatching(),
          languageCompartment.of(languageExtension(language)),
          monokaiHighlight,
          editorTheme,
          activeLineField,
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorState.readOnly.of(readOnly),
        ],
      }),
      parent: host,
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; value/activeLine flow through effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageCompartment.reconfigure(languageExtension(language)),
    });
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && value !== view.state.doc.toString()) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: setActiveLineEffect.of(activeLine) });
  }, [activeLine]);

  return (
    <div
      ref={hostRef}
      role="group"
      aria-label={
        ariaLabel ?? `${language === 'typescript' ? 'TypeScript' : 'JavaScript'} code editor`
      }
      className="as-editor-host h-full min-h-0 overflow-hidden"
    />
  );
}
