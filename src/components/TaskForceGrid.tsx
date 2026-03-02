import React from 'react';
import { TASK_FORCES, TaskForce } from '../taskForces';
import { motion } from 'motion/react';
import { ArrowRight, Users } from 'lucide-react';

interface TaskForceGridProps {
  onSelect: (taskForce: TaskForce) => void;
}

export const TaskForceGrid: React.FC<TaskForceGridProps> = ({ onSelect }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
      {TASK_FORCES.map((tf, index) => (
        <motion.button
          key={tf.id}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.1 }}
          onClick={() => onSelect(tf)}
          className="group relative flex flex-col items-start text-left bg-zinc-900/50 border border-zinc-800 hover:border-zinc-600 hover:bg-zinc-900 p-6 rounded-xl transition-colors duration-300 h-full hover:-translate-y-1 will-change-transform transform transition-transform ease-out"
        >
          <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400">
            <ArrowRight size={20} />
          </div>
          
          <div className="mb-4 p-3 bg-black border border-zinc-800 rounded-lg group-hover:border-zinc-600 transition-colors">
            <Users size={24} className="text-zinc-400 group-hover:text-white transition-colors" />
          </div>

          <h3 className="text-lg font-mono font-bold uppercase tracking-wider text-white mb-2 group-hover:text-emerald-400 transition-colors">
            {tf.name}
          </h3>
          
          <p className="text-sm text-zinc-400 mb-6 font-light leading-relaxed">
            {tf.purpose}
          </p>

          <div className="mt-auto w-full space-y-2 border-t border-zinc-800 pt-4">
            {tf.agents.map((agent, i) => (
              <div key={i} className="flex items-center gap-2 text-xs font-mono text-zinc-500">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-700 group-hover:bg-zinc-500 transition-colors" />
                <span className="truncate">{agent.name}</span>
              </div>
            ))}
          </div>
        </motion.button>
      ))}
    </div>
  );
};
