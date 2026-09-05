import React from "react";
import { Plus } from "lucide-react";

export default function SearchResultRow({ result, onAdd }) {
  return (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors">
      <div className="truncate">
        <p className="font-medium text-sm text-white truncate">{result.title}</p>
        <p className="text-xs text-gray-400 truncate">{result.artist}</p>
      </div>
      <button 
        onClick={() => onAdd(result)}
        className="flex items-center gap-1 text-xs bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 px-3 py-1.5 rounded-full font-medium transition-colors"
      >
        <Plus size={14} /> Add
      </button>
    </div>
  );
}
