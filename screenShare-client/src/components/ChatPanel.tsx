import React, { useState, useEffect, useRef } from 'react';
import { Send } from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { socket } from '../services/socket';
import { cn } from '../utils/cn';

export function ChatPanel() {
  const [input, setInput] = useState('');
  const [sendError, setSendError] = useState('');
  const { messages } = useAppStore();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    setSendError('');
    socket.emit('sendRoomMessage', { content: input }, (response: any) => {
      if (response?.error) {
        setSendError(response.error);
        setTimeout(() => setSendError(''), 3500);
      }
    });
    setInput('');
  };

  const formatTime = (ts: number) => {
    try {
      return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border-l border-gray-800 text-gray-100">
      <div className="p-4 border-b border-gray-800 bg-gray-800/50">
        <h2 className="text-lg font-semibold">Live Chat</h2>
        <p className="text-xs text-gray-400 mt-1">
          Messages are live-only and disappear when the session ends.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide">
        {messages.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-10">
            No messages yet. Say hello!
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                "flex flex-col",
                msg.type === 'system' ? 'items-center' : 'items-start'
              )}
            >
              {msg.type === 'system' ? (
                <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">
                  {formatTime(msg.timestamp)} • {msg.content}
                </span>
              ) : (
                <div
                  className={cn(
                    "max-w-[90%] rounded-lg px-3 py-2",
                    msg.senderId === socket.id
                      ? "bg-blue-600 text-white ml-auto"
                      : "bg-gray-800 text-gray-100"
                  )}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-xs text-gray-200 opacity-80">{msg.displayName}</div>
                    <div className="text-[10px] text-gray-300 opacity-60 ml-2">{formatTime(msg.timestamp)}</div>
                  </div>
                  <div className="text-sm break-words">{msg.content}</div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {sendError && (
        <div className="mx-4 mb-1 px-3 py-1.5 bg-red-500/20 border border-red-500/40 text-red-400 text-xs rounded-md">
          {sendError}
        </div>
      )}
      <form onSubmit={handleSend} className="p-4 border-t border-gray-800 bg-gray-800/50 flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 bg-gray-900 border border-gray-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-blue-500 text-gray-100"
          maxLength={500}
        />
        <button
          type="submit"
          disabled={!input.trim()}
          className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

