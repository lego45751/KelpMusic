import React from "react";
import { Play, Pause, ChevronLeft } from "lucide-react";

export default function NowPlaying({ song, isPlaying, onTogglePlay, onBack }) {
  if (!song) return null;

  return (
    <div className="flex items-center justify-between p-4 bg-zinc-900 border-t border-zinc-800">
      <div className="flex items-center gap-3">
        {onBack && (
          <button onClick={onBack} className="text-gray-400 hover:text-white">
            <ChevronLeft size={20} />
          </button>
        )}
        <div>
          <p className="font-medium text-sm text-white">{song.title}</p>
          <p className="text-xs text-gray-400">{song.artist}</p>
        </div>
      </div>
      <button 
        onClick={onTogglePlay} 
        className="p-3 rounded-full bg-emerald-500 text-black hover:scale-105 transition-transform"
      >
        {isPlaying ? <Pause size={18} /> : <Play size={18} />}
      </button>
    </div>
  );
}
