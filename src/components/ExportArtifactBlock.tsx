import React from 'react';
import { Download } from 'lucide-react';

export const ExportArtifactBlock = ({ conversation, onExport }: { conversation: any, onExport: () => void }) => {
  return (
    <div className="mt-8 border-t-2 border-[#FFD100]/30 pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div className="flex items-center gap-2 text-zinc-500 font-mono text-xs uppercase tracking-widest">
        <div className="w-2 h-2 bg-[#FFD100]"></div>
        Synthesis Complete. Artifact Ready.
      </div>
      
      <button 
        onClick={onExport}
        className="flex items-center justify-center gap-2 px-4 py-2 bg-[#FFD100]/10 text-[#FFD100] border border-[#FFD100]/50 hover:bg-[#FFD100] hover:text-[#09090b] font-black font-mono text-xs uppercase tracking-widest transition-all group shrink-0"
      >
        <Download size={14} className="group-hover:-translate-y-0.5 transition-transform" />
        Export Artifact
      </button>
    </div>
  );
};
