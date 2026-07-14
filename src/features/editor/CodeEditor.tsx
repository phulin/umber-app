import { defaultHighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { type Diagnostic as CodeMirrorDiagnostic, setDiagnostics } from "@codemirror/lint";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  createCodeMirror,
  createEditorControlledValue,
  createEditorReadonly,
} from "solid-codemirror";
import { createEffect, createMemo, onCleanup } from "solid-js";
import type { Diagnostic } from "../tex-compile/protocol";
import { type TextEditDelta, Utf8OffsetMap } from "./utf8OffsetMap";

export type EditorDelta = TextEditDelta & { docId: string };
export type EditorCursor = { docId: string; utf16Offset: number; byteOffset: number };

type CodeEditorProps = {
  docId: string;
  value: string;
  readOnly?: boolean;
  diagnostics?: readonly Diagnostic[];
  cursorTarget?: { offset: number; endOffset?: number; requestId: number };
  onChange?: (value: string) => void;
  onDelta?: (delta: EditorDelta) => void;
  onCursor?: (cursor: EditorCursor) => void;
};

const editorTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "#fffdf8",
      color: "#25221f",
    },
    ".cm-content": { caretColor: "#27615d" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "#27615d" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "#c9dedb",
    },
    ".cm-gutters": {
      backgroundColor: "#f4f1ea",
      color: "#6e6861",
      borderRightColor: "#d8d1c6",
    },
    ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "#f1eee7" },
    ".cm-tooltip": {
      backgroundColor: "#fffdf8",
      border: "1px solid #bdb5aa",
      color: "#25221f",
    },
    ".cm-tooltip-lint .cm-diagnostic": { color: "#25221f" },
    ".cm-panel": { color: "#25221f" },
  },
  { dark: false },
);

export function engineDiagnosticsToCodeMirror(
  diagnostics: readonly Diagnostic[],
  offsets: Utf8OffsetMap,
): CodeMirrorDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    from: offsets.byteToUtf16(Math.min(diagnostic.byteStart, offsets.byteLength)),
    to: offsets.byteToUtf16(Math.min(diagnostic.byteEnd, offsets.byteLength)),
    severity: diagnostic.severity,
    message: diagnostic.message,
  }));
}

export function CodeEditor(props: CodeEditorProps) {
  const readOnly = createMemo(() => props.readOnly ?? false);
  const offsets = new Utf8OffsetMap(props.value);
  let cursorTimer: number | undefined;
  const { createExtension, editorView, ref } = createCodeMirror({ value: props.value });

  const emitCursor = (utf16Offset: number) => {
    if (!props.onCursor) return;
    if (cursorTimer !== undefined) window.clearTimeout(cursorTimer);
    cursorTimer = window.setTimeout(() => {
      cursorTimer = undefined;
      props.onCursor?.({
        docId: props.docId,
        utf16Offset,
        byteOffset: offsets.utf16ToByte(utf16Offset),
      });
    }, 100);
  };

  createEditorControlledValue(editorView, () => props.value);
  createEditorReadonly(editorView, readOnly);

  createExtension(basicSetup);
  createExtension(StreamLanguage.define(stex));
  createExtension(editorTheme);
  createExtension(syntaxHighlighting(defaultHighlightStyle));
  createExtension(EditorView.lineWrapping);
  createExtension(() => EditorView.editable.of(!readOnly()));
  createExtension(
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const value = update.state.doc.toString();
        const delta = offsets.replaceWith(value);
        if (delta) props.onDelta?.({ ...delta, docId: props.docId });
        props.onChange?.(value);
      }
      if (update.selectionSet || update.docChanged) emitCursor(update.state.selection.main.head);
    }),
  );

  createEffect(() => {
    const view = editorView();
    if (!view) return;
    view.dispatch(
      setDiagnostics(view.state, engineDiagnosticsToCodeMirror(props.diagnostics ?? [], offsets)),
    );
  });

  createEffect(() => {
    const target = props.cursorTarget;
    const view = editorView();
    if (target === undefined || !view) return;
    const position = Math.max(0, Math.min(target.offset, view.state.doc.length));
    const endPosition = Math.max(0, Math.min(target.endOffset ?? position, view.state.doc.length));
    view.dispatch({
      selection: { anchor: position, head: endPosition },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    view.focus();
  });

  onCleanup(() => {
    if (cursorTimer !== undefined) window.clearTimeout(cursorTimer);
  });

  return <div ref={ref} class="code-editor" />;
}
