import React, { useState } from 'react';
import Markdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';
import { TypewriterText } from './ChatMessage';

interface AgentResponseCardProps {
  provocation: string;
  fullAnalysis: string;
  agentColor: string;
  isTyping?: boolean;
}

export const AgentResponseCard: React.FC<AgentResponseCardProps> = ({ provocation, fullAnalysis, agentColor, isTyping }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      {/* Provocation - Large, Bold, Highly Legible */}
      <div className="text-xl md:text-2xl font-bold text-white leading-tight tracking-tight">
        <TypewriterText text={provocation} isTyping={isTyping} />
      </div>

      {/* Toggle Button - Distinctive Rationale Trigger */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="text-xs font-mono font-bold uppercase tracking-widest text-zinc-500 hover:text-white mt-4 transition-colors w-fit flex items-center gap-2"
      >
        <span>{isExpanded ? '[ - HIDE RATIONALE ]' : '[ + EXPAND RATIONALE ]'}</span>
      </button>

      {/* Expanded State - Stark Reveal */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="overflow-hidden"
          >
            <div 
              className="pl-6 py-2 border-l border-zinc-700 text-zinc-400 text-sm leading-relaxed markdown-body"
              style={{ borderLeftColor: agentColor }}
            >
              <Markdown>{fullAnalysis}</Markdown>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
