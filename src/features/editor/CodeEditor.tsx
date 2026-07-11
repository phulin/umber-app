import { StreamLanguage } from "@codemirror/language";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import {
  createCodeMirror,
  createEditorControlledValue,
  createEditorReadonly,
} from "solid-codemirror";
import { createMemo } from "solid-js";

type CodeEditorProps = {
  value: string;
  readOnly?: boolean;
  onChange?: (value: string) => void;
};

export function CodeEditor(props: CodeEditorProps) {
  const readOnly = createMemo(() => props.readOnly ?? false);
  const { createExtension, editorView, ref } = createCodeMirror({
    value: props.value,
    onValueChange: (value) => props.onChange?.(value),
  });

  createEditorControlledValue(editorView, () => props.value);
  createEditorReadonly(editorView, readOnly);

  createExtension(basicSetup);
  createExtension(StreamLanguage.define(stex));
  createExtension(EditorView.lineWrapping);
  createExtension(() => EditorView.editable.of(!readOnly()));

  return <div ref={ref} class="code-editor" />;
}
