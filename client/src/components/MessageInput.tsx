import { useState, useRef, useEffect } from 'react';

interface Props {
  onSend: (text: string) => void;
  disabled?: boolean;
  onTyping?: (typing: boolean) => void;
}

export default function MessageInput({ onSend, disabled, onTyping }: Props) {
  const [text, setText] = useState('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTyping = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
    stopTyping();
    // Reset textarea height
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const stopTyping = () => {
    if (isTyping.current) {
      isTyping.current = false;
      onTyping?.(false);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // Auto-resize
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';

    if (!isTyping.current) {
      isTyping.current = true;
      onTyping?.(true);
    }
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(stopTyping, 2000);
  };

  useEffect(() => () => { if (typingTimer.current) clearTimeout(typingTimer.current); }, []);

  return (
    <div className="msg-input-row">
      <textarea
        ref={textareaRef}
        className="msg-input"
        placeholder="Message…"
        value={text}
        onChange={handleChange}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
        disabled={disabled}
        rows={1}
      />
      <button
        className="btn-send"
        onClick={handleSend}
        disabled={!text.trim() || disabled}
        aria-label="Send"
      >
        ↑
      </button>
    </div>
  );
}
