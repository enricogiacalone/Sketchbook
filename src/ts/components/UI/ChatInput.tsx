import React, { useState, useRef, useEffect } from 'react';
import { useStore } from '../../store';

const ChatInput: React.FC = () => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [message, setMessage] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { setPlayerMessage } = useStore();

  const handleToggle = () => {
    setIsExpanded(!isExpanded);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (message.trim()) {
        console.log('Sending message:', message);
        setPlayerMessage(message); // Set message in store
        
        // Clear message after 5 seconds
        setTimeout(() => {
          setPlayerMessage('');
        }, 5000);

        setMessage('');
      }
      setIsExpanded(false);
    } else if (e.key === 'Escape') {
      setIsExpanded(false);
    }
  };

  useEffect(() => {
    if (isExpanded && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isExpanded]);

  // Handle clicking outside to collapse
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const container = document.getElementById('chat-input-container');
      if (container && !container.contains(event.target as Node)) {
        setIsExpanded(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div 
      id="chat-input-container" 
      className={isExpanded ? 'expanded' : 'collapsed'}
      onClick={!isExpanded ? handleToggle : undefined}
      style={{ pointerEvents: 'auto' }}
    >
      <input
        ref={inputRef}
        id="chat-input"
        type="text"
        placeholder="Type message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    </div>
  );
};

export default ChatInput;
