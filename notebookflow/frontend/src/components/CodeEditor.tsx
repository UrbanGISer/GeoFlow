import Editor from "@monaco-editor/react";

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
}

export function CodeEditor({ value, onChange, height = "240px" }: CodeEditorProps) {
  return (
    <div className="nf-code-editor-wrap">
      <Editor
        height={height}
        defaultLanguage="python"
        theme="vs-light"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          tabSize: 4,
        }}
      />
    </div>
  );
}
