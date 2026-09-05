import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  Upload, Music, ListMusic, Download, Plus, Play, Pause, ChevronLeft,
  Search, Wifi, WifiOff, Loader2, CloudDownload,
} from "lucide-react";
import toast, { Toaster as HotToaster } from "react-hot-toast";
import KelpLogo from "./KelpLogo.jsx";
import SongRow from "./SongRow.jsx";
import SearchResultRow from "./SearchResultRow.jsx";
import NowPlaying from "./NowPlaying.jsx";
import {
  saveSong, getAllSongs, deleteSong, getSongUrl, revokeSongUrl,
} from "./lib/kelpDB";
} from "./lib/kelpDB";
const PLAYLISTS_KEY = "kelp.playlists.v2";
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function parseMeta(fileName) {
  const base = fileName.replace(/\.[^.]+$/, "");
  const parts = base.split(" - ");
  if (parts.length >= 2) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(" - ").trim() };
  }
  return { title: base.trim(), artist: "Unknown artist" };
}

function readDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;
    const done = (d) => {
      URL.revokeObjectURL(url);
      resolve(isFinite(d) ? d : 0);
    };
    a.onloadedmetadata = () => done(a.duration);
    a.onerror = () => done(0);
    setTimeout(() => done(a.duration), 4000);
  });
}

function mapItunesTrack(t) {
  return {
    id: `itu_${t.trackId}`,
    title: t.trackName || "Unknown",
    artist: t.artistName || "Unknown artist",
    album: t.collectionName || "",
    albumArt: t.artworkUrl100
      ? t.artworkUrl100.replace("100x100bb", "300x300bb")
      : null,
    streamUrl: t.previewUrl,
    duration: (t.trackTimeMillis || 0) / 1000,
    source: "itunes",
    stored: false,
  };
}

export default function Kelp() {
  const audioRef = useRef(null);
  const fileInputRef = useRef(null);

  const [songs, setSongs] = useState([]); // locally stored (offline) tracks
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("search");

  const [searchQuery, setSearchQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  // connection
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );

  // playback (unified queue holds either stored songs or online tracks)
  const [playQueue, setPlayQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState("off");
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);

  // downloads
  const [downloading, setDownloading] = useState(new Set());

  // playlists
  const [playlists, setPlaylists] = useState([]);
  const [openPlaylist, setOpenPlaylist] = useState(null);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [showNewPlaylist, setShowNewPlaylist] = useState(false);
  const [addTarget, setAddTarget] = useState(null);

  const songsById = useMemo(() => {
    const m = new Map();
    songs.forEach((s) => m.set(s.id, s));
    return m;
  }, [songs]);

  const currentSong = currentIndex >= 0 ? playQueue[currentIndex] : null;

  // ---- initial load ----
  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([
        getAllSongs(),
        Promise.resolve(JSON.parse(localStorage.getItem(PLAYLISTS_KEY) || "[]")),
      ]);
      setSongs(s);
      setPlaylists(p);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(playlists));
  }, [playlists]);

  // ---- online/offline detection ----
  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => {
      setOnline(false);
      setTab("downloads");
      setResults([]);
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    if (!navigator.onLine) setTab("downloads");
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  // ---- online search (debounced) ----
  useEffect(() => {
    if (!online || tab !== "search") return;
    const q = searchQuery.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(
          `https://itunes.apple.com/search?term=${encodeURIComponent(
            q
          )}&media=music&entity=song&limit=30`
        );
        const data = await res.json();
        if (!cancelled) setResults((data.results || []).map(mapItunesTrack));
      } catch {
        if (!cancelled) {
          setResults([]);
          toast.error("Search failed. Check your connection.");
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [searchQuery, online, tab]);

  // ---- audio element wiring ----
  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = muted ? 0 : volume;
  }, [volume, muted]);

  const loadSong = useCallback(
    async (song) => {
      const a = audioRef.current;
      if (!song) return;
      let url;
      if (songsById.has(song.id)) {
        url = await getSongUrl(song.id);
      } else if (song.streamUrl) {
        url = song.streamUrl;
      }
      if (!url) {
        toast.error("This track can't be played.");
        return;
      }
      a.src = url;
      a.currentTime = 0;
      setProgress(0);
      try {
        await a.play();
        setIsPlaying(true);
      } catch {
        setIsPlaying(false);
      }
      setNowPlayingOpen(true);
    },
    [songsById]
  );

  const playFromList = useCallback(
    (list, index) => {
      if (index < 0 || index >= list.length) return;
      setPlayQueue(list);
      setCurrentIndex(index);
      loadSong(list[index]);
    },
    [loadSong]
  );

  const nextIndex = useCallback(
    (dir = 1) => {
      if (!playQueue.length) return -1;
      const idx = currentIndex;
      if (shuffle) {
        let r = idx;
        while (r === idx && playQueue.length > 1)
          r = Math.floor(Math.random() * playQueue.length);
        return r;
      }
      const n = idx + dir;
      if (n >= playQueue.length) return repeat === "all" ? 0 : -1;
      if (n < 0) return repeat === "all" ? playQueue.length - 1 : -1;
      return n;
    },
    [playQueue, currentIndex, shuffle, repeat]
  );

  const playNext = useCallback(
    async (auto = false) => {
      if (auto && repeat === "one" && currentSong) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
        return;
      }
      const i = nextIndex(1);
      if (i === -1) {
        setIsPlaying(false);
        return;
      }
      setCurrentIndex(i);
      await loadSong(playQueue[i]);
    },
    [nextIndex, currentSong, loadSong, playQueue]
  );

  const playPrev = useCallback(async () => {
    if (progress > 3) {
      audioRef.current.currentTime = 0;
      return;
    }
    const i = nextIndex(-1);
    if (i !== -1) {
      setCurrentIndex(i);
      await loadSong(playQueue[i]);
    }
  }, [nextIndex, progress, loadSong, playQueue]);

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!currentSong) {
      if (playQueue[0]) loadSong(playQueue[0]);
      return;
    }
    if (a.paused) {
      a.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      a.pause();
      setIsPlaying(false);
    }
  }, [currentSong, playQueue, loadSong]);

  // ---- import local audio ----
  const onImport = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    const t = toast.loading(`Importing ${files.length} file(s)...`);
    for (const file of files) {
      const id = uid();
      const { title, artist } = parseMeta(file.name);
      const dur = await readDuration(file);
      const meta = {
        id, title, artist, album: "", albumArt: null, duration: dur,
        fileName: file.name, source: "local", addedAt: Date.now(), stored: true,
      };
      await saveSong(meta, file);
      setSongs((prev) => [meta, ...prev]);
    }
    toast.success("Imported to your offline library.", { id: t });
    setTab("downloads");
  };

  const removeSong = async (id) => {
    await deleteSong(id);
    revokeSongUrl(id);
    setSongs((prev) => prev.filter((s) => s.id !== id));
    setPlaylists((prev) =>
      prev.map((p) => ({ ...p, songIds: p.songIds.filter((sid) => sid !== id) }))
    );
    if (id === currentSong?.id) {
      audioRef.current?.pause();
      setCurrentIndex(-1);
      setPlayQueue([]);
      setIsPlaying(false);
      setNowPlayingOpen(false);
    }
  };

  // ---- download online track for offline ----
  const downloadTrack = async (track) => {
    if (downloading.has(track.id) || songsById.has(track.id)) return;
    setDownloading((prev) => new Set(prev).add(track.id));
    const t = toast.loading(`Downloading "${track.title}"...`);
    try {
      const res = await fetch(track.streamUrl);
      if (!res.ok) throw new Error("fetch failed");
      const blob = await res.blob();
      const meta = {
        ...track,
        stored: true,
        addedAt: Date.now(),
      };
      await saveSong(meta, blob);
      setSongs((prev) => [meta, ...prev]);
      toast.success("Saved offline. Find it in Downloads.", { id: t });
    } catch {
      toast.error("Download blocked by source. Streaming still works online.", {
        id: t,
      });
    } finally {
      setDownloading((prev) => {
        const n = new Set(prev);
        n.delete(track.id);
        return n;
      });
    }
  };

  // ---- playlists ----
  const createPlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) return;
    const pl = { id: uid(), name, songIds: [] };
    setPlaylists((prev) => [pl, ...prev]);
    setNewPlaylistName("");
    setShowNewPlaylist(false);
    if (addTarget) {
      setPlaylists((prev) =>
        prev.map((p) =>
          p.id === pl.id ? { ...p, songIds: [...p.songIds, addTarget.id] } : p
        )
      );
      setAddTarget(null);
    }
  };

  const addToPlaylist = (playlistId) => {
    if (!addTarget) return;
    setPlaylists((prev) =>
      prev.map((p) =>
        p.id === playlistId && !p.songIds.includes(addTarget.id)
          ? { ...p, songIds: [...p.songIds, addTarget.id] }
          : p
      )
    );
    setAddTarget(null);
  };

  const cycleRepeat = () =>
    setRepeat((r) => (r === "off" ? "all" : r === "all" ? "one" : "off"));

  // ---- derived lists ----
  const downloadsList = useMemo(() => {
    if (!searchQuery.trim()) return songs;
    const q = searchQuery.toLowerCase();
    return songs.filter(
      (s) =>
        s.title.toLowerCase().includes(q) || s.artist.toLowerCase().includes(q)
    );
  }, [songs, searchQuery]);

  const playlistSongs = useMemo(() => {
    if (!openPlaylist) return [];
    const pl = playlists.find((p) => p.id === openPlaylist);
    return songs.filter((s) => pl?.songIds?.includes(s.id));
  }, [openPlaylist, playlists, songs]);

  const tabs = [
    { id: "search", label: "Search", icon: Search },
    { id: "downloads", label: "Downloads", icon: CloudDownload },
    { id: "playlists", label: "Playlists", icon: ListMusic },
  ];

  return (
    <div className="min-h-screen bg-[#0b132b] text-slate-100">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-500/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-72 w-72 rounded-full bg-emerald-700/15 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-md flex-col px-5 pb-40 pt-7">
        {/* header */}
        <header className="mb-5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <KelpLogo className="h-11 w-11 drop-shadow-[0_0_12px_rgba(34,197,94,0.4)]" />
            <div>
              <h1 className="text-2xl font-extrabold tracking-tight text-white">Kelp</h1>
              <p className="text-[11px] font-medium uppercase tracking-widest text-emerald-400/80">
                Offline Music
              </p>
            </div>
          </div>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
              online
                ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-300"
                : "border-amber-400/30 bg-amber-500/10 text-amber-300"
            }`}
          >
            {online ? (
              <>
                <Wifi className="h-3 w-3" /> Online
              </>
            ) : (
              <>
                <WifiOff className="h-3 w-3" /> Offline Mode
              </>
            )}
          </span>
        </header>

        {/* search bar */}
        <div className="relative mb-4">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => online && setTab("search")}
            placeholder={online ? "Search songs, artists, albums..." : "Search your downloads..."}
            className="w-full rounded-2xl border border-slate-700/60 bg-[#1e293b] py-3 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none transition focus:border-emerald-400/50"
          />
        </div>

        {/* tabs */}
        <div className="mb-4 flex gap-1 rounded-2xl border border-slate-700/50 bg-[#1e293b] p-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = tab === t.id && !openPlaylist;
            const disabled = t.id === "search" && !online;
            return (
              <button
                key={t.id}
                onClick={() => { setTab(t.id); setOpenPlaylist(null); }}
                disabled={disabled}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-semibold transition disabled:opacity-40 ${
                  active
                    ? "bg-emerald-500 text-[#0b132b]"
                    : "text-slate-400 hover:text-emerald-200"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* import button */}
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,.mp3,.wav,.m4a"
          multiple
          onChange={onImport}
          className="hidden"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="mb-5 flex items-center justify-center gap-2.5 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 px-6 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/20 active:scale-[0.98]"
        >
          <Upload className="h-5 w-5" />
          Import Local Audio
        </button>

        {/* content */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="h-7 w-7 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
          </div>
        ) : tab === "search" ? (
          <div className="space-y-1">
            {!online ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <WifiOff className="mb-3 h-10 w-10 text-amber-400/70" />
                <p className="text-sm font-medium text-slate-200">You're offline</p>
                <p className="mt-1 text-xs text-slate-400">
                  Showing only your downloaded tracks.
                </p>
              </div>
            ) : !searchQuery.trim() ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Search className="mb-3 h-10 w-10 text-slate-600" />
                <p className="text-sm text-slate-400">
                  Search the web for songs, artists, or albums.
                </p>
              </div>
            ) : searching ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-400" /> Searching...
              </div>
            ) : results.length === 0 ? (
              <p className="py-16 text-center text-sm text-slate-400">
                No results for "{searchQuery}".
              </p>
            ) : (
              results.map((track, i) => (
                <SearchResultRow
                  key={track.id}
                  track={track}
                  isCurrent={track.id === currentSong?.id}
                  isPlaying={isPlaying}
                  downloaded={songsById.has(track.id)}
                  downloading={downloading.has(track.id)}
                  onPlay={() => playFromList(results, i)}
                  onDownload={downloadTrack}
                />
              ))
            )}
          </div>
        ) : tab === "downloads" ? (
          <div className="space-y-0.5">
            {downloadsList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Download className="mb-3 h-10 w-10 text-slate-600" />
                <p className="text-sm text-slate-400">
                  {songs.length === 0
                    ? "No downloads yet. Search and tap Download, or import local audio."
                    : "No tracks match your search."}
                </p>
              </div>
            ) : (
              downloadsList.map((song, i) => (
                <SongRow
                  key={song.id}
                  song={song}
                  isCurrent={song.id === currentSong?.id}
                  isPlaying={isPlaying}
                  onPlay={() => playFromList(downloadsList, i)}
                  onAddToPlaylist={setAddTarget}
                />
              ))
            )}
          </div>
        ) : openPlaylist ? (
          <div className="space-y-0.5">
            <button
              onClick={() => setOpenPlaylist(null)}
              className="mb-3 flex items-center gap-1.5 text-sm font-medium text-emerald-300"
            >
              <ChevronLeft className="h-4 w-4" /> All playlists
            </button>
            {playlistSongs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Music className="mb-3 h-10 w-10 text-slate-600" />
                <p className="text-sm text-slate-400">
                  {songs.length === 0
                    ? "No songs yet. Import local audio or download from Search."
                    : "Nothing here yet."}
                </p>
              </div>
            ) : (
              playlistSongs.map((song, i) => (
                <SongRow
                  key={song.id}
                  song={song}
                  isCurrent={song.id === currentSong?.id}
                  isPlaying={isPlaying}
                  onPlay={() => playFromList(playlistSongs, i)}
                  onAddToPlaylist={setAddTarget}
                />
              ))
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {showNewPlaylist && (
              <div className="flex items-center gap-2 rounded-xl border border-slate-700/60 bg-[#1e293b] p-3">
                <input
                  autoFocus
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
                  placeholder="Playlist name"
                  className="flex-1 rounded-lg bg-slate-800/60 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-emerald-400"
                />
                <button
                  onClick={createPlaylist}
                  className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-[#0b132b]"
                >
                  Create
                </button>
              </div>
            )}
            <button
              onClick={() => setShowNewPlaylist((v) => !v)}
              className="flex w-full items-center gap-3 rounded-xl border border-dashed border-slate-600/70 px-4 py-3.5 text-sm font-medium text-slate-300 transition hover:border-emerald-400/50 hover:text-emerald-300"
            >
              <Plus className="h-5 w-5" /> New Playlist
            </button>
            {playlists.length === 0 && !showNewPlaylist ? (
              <p className="py-10 text-center text-sm text-slate-500">No playlists yet.</p>
            ) : (
              playlists.map((pl) => (
                <button
                  key={pl.id}
                  onClick={() => setOpenPlaylist(pl.id)}
                  className="flex w-full items-center gap-3 rounded-xl border border-slate-700/50 bg-[#1e293b] px-4 py-3.5 text-left transition hover:border-emerald-400/40"
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-500/15">
                    <ListMusic className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{pl.name}</p>
                    <p className="text-xs text-slate-400">{pl.songIds.length} songs</p>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* mini player */}
      {currentSong && !nowPlayingOpen && (
        <button
          onClick={() => setNowPlayingOpen(true)}
          className="fixed bottom-0 left-1/2 z-30 flex w-full max-w-md items-center gap-3 border-t border-slate-700/60 bg-[#1e293b]/95 px-4 py-3 backdrop-blur"
        >
          {currentSong.albumArt ? (
            <img
              src={currentSong.albumArt}
              alt=""
              className="h-11 w-11 shrink-0 rounded-lg object-cover"
            />
          ) : (
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/80 to-teal-700 text-sm font-bold text-white">
              {currentSong.title?.[0]?.toUpperCase() || "♪"}
            </div>
          )}
          <div className="min-w-0 flex-1 text-left">
            <p className="truncate text-sm font-medium text-white">{currentSong.title}</p>
            <p className="truncate text-xs text-slate-400">{currentSong.artist}</p>
          </div>
          <span
            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500 text-[#0b132b]"
            aria-label="Play/Pause"
          >
            {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current pl-0.5" />}
          </span>
        </button>
      )}

      {/* add-to-playlist sheet */}
      {addTarget && (
        <div className="fixed inset-0 z-50 flex items-end" onClick={() => setAddTarget(null)}>
          <div className="absolute inset-0 bg-black/60" />
          <div
            className="relative w-full max-w-md rounded-t-3xl border-t border-slate-700/60 bg-[#1e293b] p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-slate-600" />
            <p className="mb-3 text-sm font-semibold text-white">
              Add "{addTarget.title}" to playlist
            </p>
            <button
              onClick={() => setShowNewPlaylist(true)}
              className="mb-2 flex w-full items-center gap-2 rounded-xl border border-dashed border-slate-600/70 px-4 py-3 text-sm text-slate-300 hover:border-emerald-400/50"
            >
              <Plus className="h-4 w-4" /> New playlist
            </button>
            {showNewPlaylist && (
              <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-800/60 p-2">
                <input
                  autoFocus
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createPlaylist()}
                  placeholder="Playlist name"
                  className="flex-1 rounded-lg bg-slate-900/60 px-3 py-2 text-sm text-white outline-none focus:ring-1 focus:ring-emerald-400"
                />
                <button onClick={createPlaylist} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-[#0b132b]">
                  Create
                </button>
              </div>
            )}
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {playlists.length === 0 ? (
                <p className="py-3 text-center text-xs text-slate-500">Create a playlist first.</p>
              ) : (
                playlists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => addToPlaylist(pl.id)}
                    className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm text-white hover:bg-white/5"
                  >
                    <span className="truncate">{pl.name}</span>
                    <Plus className="h-4 w-4 text-emerald-400" />
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress(e.target.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.target.duration)}
        onEnded={() => playNext(true)}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
      />

      <NowPlaying
        song={currentSong}
        isPlaying={isPlaying}
        progress={progress}
        duration={duration}
        volume={volume}
        muted={muted}
        shuffle={shuffle}
        repeat={repeat}
        onTogglePlay={togglePlay}
        onNext={() => playNext()}
        onPrev={playPrev}
        onSeek={(t) => {
          if (audioRef.current) {
            audioRef.current.currentTime = t;
            setProgress(t);
          }
        }}
        onVolume={(v) => { setVolume(v); setMuted(v === 0); }}
        onToggleMute={() => setMuted((m) => !m)}
        onToggleShuffle={() => setShuffle((s) => !s)}
        onCycleRepeat={cycleRepeat}
        onClose={() => setNowPlayingOpen(false)}
      />

      <HotToaster
        position="top-center"
        toastOptions={{
          style: {
            background: "#1e293b",
            color: "#e2e8f0",
            border: "1px solid rgba(34,197,94,0.3)",
          },
        }}
      />
    </div>
  );
}
