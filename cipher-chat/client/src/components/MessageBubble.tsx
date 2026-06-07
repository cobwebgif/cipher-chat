import { Message } from '../types';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  message: Message & { senderUsername: string };
  showSender?: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts > 9999999999 ? ts : ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function MessageBubble({ message, showSender = false }: Props) {
  const { user } = useAuth();
  const isOwn = message.senderId === user?.id;

  return (
    <div className={`msg-row ${isOwn ? 'msg-row--own' : 'msg-row--other'}`}>
      <div className={`msg-bubble ${isOwn ? 'msg-bubble--own' : 'msg-bubble--other'}`}>
        {showSender && !isOwn && (
          <span className="msg-sender">{message.senderUsername}</span>
        )}
        <p className="msg-text">
          {message.plaintext ?? (
            <span className="msg-encrypted">[encrypted]</span>
          )}
        </p>
        <span className="msg-time">{formatTime(message.createdAt)}</span>
      </div>
    </div>
  );
}
