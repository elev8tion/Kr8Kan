import { useEffect } from "react";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

/**
 * TipTap editor themed to kr8 tokens. Emits HTML; comfortable padding via
 * .kr8-editor styles + Tailwind typography for read views.
 */
export function Editor({
  content,
  onBlur,
  placeholder,
  editable = true,
}: {
  content: string;
  onBlur?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false }),
      Placeholder.configure({
        placeholder: placeholder ?? "Add a description…",
      }),
    ],
    content,
    editable,
    immediatelyRender: false,
    onBlur: ({ editor: instance }) => {
      onBlur?.(instance.isEmpty ? "" : instance.getHTML());
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  return (
    <div className="kr8-editor prose prose-sm max-w-none rounded-kr8-sm border border-kr8-border bg-kr8-bg-elevated text-kr8-fg focus-within:border-kr8-accent dark:prose-invert">
      <EditorContent editor={editor} />
    </div>
  );
}
