import { StreamLanguage } from "@codemirror/language";
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
  cursorTarget?: { offset: number; requestId: number };
  onChange?: (value: string) => void;
  onDelta?: (delta: EditorDelta) => void;
  onCursor?: (cursor: EditorCursor) => void;
};

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
    view.dispatch({
      selection: { anchor: position },
      effects: EditorView.scrollIntoView(position, { y: "center" }),
    });
    view.focus();
  });

  onCleanup(() => {
    if (cursorTimer !== undefined) window.clearTimeout(cursorTimer);
  });

  return <div ref={ref} class="code-editor" />;
}
