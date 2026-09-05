import React from "react";
import { Play, Pause, Download } from "lucide-react";

export default function SongRow({ song, isCurrent, isPlaying, onPlay, onDownload }) {
  return (
    <div className={`flex items-center justify-between p-3 rounded-lg transition-colors ${isCurrent ? "bg-emerald-500/10 text-emerald-400" : "hover:bg-white/5"}`}>
      <div className="flex items-center gap-3 overflow-hidden">
        <button 
          onClick={() => onPlay(song)} 
          className="p-2 rounded-full bg-emerald-500 text-black hover:scale-105 transition-transform flex-shrink-0"
        >
          {isCurrent && isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <div className="truncate">
          <p className="font-medium text-sm text-white truncate">{song.title}</p>
          <p className="text-xs text-gray-400 truncate">{song.artist}</p>
        </div>
      </div>
      {onDownload && (
        <button onClick={() => onDownload(song)} className="text-gray-400 hover:text-white p-2">
          <Download size={16} />
        </button>
      )}
    </div>
  );
}
