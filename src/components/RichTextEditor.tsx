import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Italic, Strikethrough, Heading2, Heading3, List, ListOrdered,
  Quote, Code, Link2, ImagePlus, Undo2, Redo2,
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, isTrustedImageUrl } from '../lib/api';

interface RichTextEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
}

/**
 * Tiptap (headless) rich-text editor za Admin CMS.
 * Ispisuje čist HTML koji se na renderu filtrira kroz DOMPurify
 * (videti src/lib/sanitizeHtml.ts) — odbrana u dubini.
 */
export default function RichTextEditor({ content, onChange, placeholder = 'Piši sadržaj članka...' }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' } }),
      Image,
      Placeholder.configure({ placeholder }),
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL linka:');
    if (!url) return;
    editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  const addImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt('URL slike:');
    if (!url) return;
    if (!isTrustedImageUrl(url)) {
      toast.error('URL mora biti naša storage adresa — ili otpremi sliku sa uređaja.');
      return;
    }
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  /**
   * 2.6.2 — slika sa uređaja umesto eksternog URL-a: upload u Supabase Storage
   * (`POST /api/uploads/article`), pa tek onda `setImage`. Server ju je već
   * pretvorio u WebP i smanjio na širinu članka.
   */
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const uploadImage = useCallback(
    async (file: File | undefined) => {
      if (!file || !editor || uploading) return;
      if (!file.type.startsWith('image/')) {
        toast.error('Izaberi sliku (JPG, PNG, WebP ili GIF).');
        return;
      }
      setUploading(true);
      try {
        const uploaded = await api.uploads.image('article', file);
        editor.chain().focus().setImage({ src: uploaded.url, alt: '' }).run();
      } catch (err: any) {
        toast.error(err?.message || 'Slika nije otpremljena.');
      } finally {
        setUploading(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [editor, uploading],
  );

  if (!editor) return null;

  const btn = (active: boolean) =>
    `cms-btn ${active ? 'is-active' : ''}`;

  return (
    <div className="cms-editor">
      {/* Toolbar */}
      <div className="cms-toolbar">
        <button type="button" className={btn(editor.isActive('bold'))} onClick={() => editor.chain().focus().toggleBold().run()} title="Podebljano" aria-label="Podebljano"><Bold size={15} /></button>
        <button type="button" className={btn(editor.isActive('italic'))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Kurziv" aria-label="Kurziv"><Italic size={15} /></button>
        <button type="button" className={btn(editor.isActive('strike'))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Precrtano" aria-label="Precrtano"><Strikethrough size={15} /></button>
        <span className="cms-toolbar-sep" />
        <button type="button" className={btn(editor.isActive('heading', { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Naslov H2" aria-label="Naslov H2"><Heading2 size={15} /></button>
        <button type="button" className={btn(editor.isActive('heading', { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Naslov H3" aria-label="Naslov H3"><Heading3 size={15} /></button>
        <span className="cms-toolbar-sep" />
        <button type="button" className={btn(editor.isActive('bulletList'))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Lista" aria-label="Bullet lista"><List size={15} /></button>
        <button type="button" className={btn(editor.isActive('orderedList'))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numerisana lista" aria-label="Numerisana lista"><ListOrdered size={15} /></button>
        <button type="button" className={btn(editor.isActive('blockquote'))} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Citat" aria-label="Citat"><Quote size={15} /></button>
        <button type="button" className={btn(editor.isActive('codeBlock'))} onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Kod blok" aria-label="Kod blok"><Code size={15} /></button>
        <span className="cms-toolbar-sep" />
        <button type="button" className={btn(editor.isActive('link'))} onClick={setLink} title="Link" aria-label="Dodaj link"><Link2 size={15} /></button>
        <button type="button" className={btn(false)} onClick={() => fileRef.current?.click()} title="Otpremi sliku" aria-label="Otpremi sliku" disabled={uploading}>
          <ImagePlus size={15} />
        </button>
        <button type="button" className={btn(false)} onClick={addImage} title="Slika sa URL-a" aria-label="Slika sa URL-a">
          <Link2 size={15} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          tabIndex={-1}
          onChange={(event) => void uploadImage(event.target.files?.[0])}
        />
        <span className="cms-toolbar-sep" />
        <button type="button" className={btn(false)} onClick={() => editor.chain().focus().undo().run()} title="Opozovi" aria-label="Opozovi"><Undo2 size={15} /></button>
        <button type="button" className={btn(false)} onClick={() => editor.chain().focus().redo().run()} title="Ponovi" aria-label="Ponovi"><Redo2 size={15} /></button>
      </div>

      {/* Prostor za pisanje */}
      <EditorContent editor={editor} className="cms-editor-body" aria-label="Sadržaj članka" />
    </div>
  );
}
