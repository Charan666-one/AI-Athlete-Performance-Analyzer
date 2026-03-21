import React, { useState, useEffect, useRef, useCallback, useMemo, memo } from "react";
import { 
  LayoutDashboard, 
  MessageSquare, 
  StickyNote, 
  Settings, 
  Plus, 
  Search, 
  Trash2, 
  Send, 
  Sparkles,
  ChevronRight,
  Clock,
  Tag,
  MoreVertical,
  Activity,
  HeartPulse,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Upload,
  FileText,
  Loader2
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ReactMarkdown from "react-markdown";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import Papa from "papaparse";
import { getGeminiResponse, analyzeAthleteHealth } from "./services/geminiService";
import { classifyAthlete } from "./services/classifierService";

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface Note {
  id: number;
  title: string;
  content: string;
  category: string;
  created_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface HealthReport {
  id: number;
  athlete_name: string;
  age: number;
  sport: string;
  vitals: string; // JSON string
  analysis: string;
  status: 'Ready' | 'Caution' | 'Suspicious';
  created_at: string;
}

declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"dashboard" | "notes" | "chat" | "analysis">("dashboard");
  const [notes, setNotes] = useState<Note[]>([]);
  const [reports, setReports] = useState<HealthReport[]>([]);
  const [isAddingNote, setIsAddingNote] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [newNote, setNewNote] = useState({ title: "", content: "", category: "General" });
  const [athleteData, setAthleteData] = useState({
    name: "",
    age: 25,
    sport: "",
    vitals: {
      heartRate: 60,
      bloodPressure: "120/80",
      testosterone: 500,
      hematocrit: 45,
      weightChange: 0,
      symptoms: ""
    }
  });
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isAnalysisLoading, setIsAnalysisLoading] = useState(false);
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);
  const [processingProgress, setProcessingProgress] = useState({ current: 0, total: 0 });
  const [hasApiKey, setHasApiKey] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchNotes();
    fetchReports();
    checkApiKey();
  }, []);

  const checkApiKey = useCallback(async () => {
    if (window.aistudio) {
      const selected = await window.aistudio.hasSelectedApiKey();
      setHasApiKey(selected);
    }
  }, []);

  const handleOpenKeySelector = useCallback(async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasApiKey(true);
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const fetchNotes = useCallback(async () => {
    try {
      const res = await fetch("/api/notes");
      const data = await res.json();
      setNotes(data);
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    }
  }, []);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/reports");
      const data = await res.json();
      setReports(data);
    } catch (err) {
      console.error("Failed to fetch reports:", err);
    }
  }, []);

  const handleAnalyzeAthlete = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!athleteData.name.trim()) return;
    setIsAnalysisLoading(true);

    try {
      const result = await analyzeAthleteHealth(athleteData);
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athlete_name: athleteData.name,
          age: athleteData.age,
          sport: athleteData.sport,
          vitals: athleteData.vitals,
          analysis: result.analysis,
          status: result.status
        }),
      });
      if (res.ok) {
        setIsAnalyzing(false);
        fetchReports();
        setActiveTab("analysis");
      }
    } catch (err) {
      console.error("Analysis error:", err);
    } finally {
      setIsAnalysisLoading(false);
    }
  }, [athleteData, fetchReports]);

  const handleDeleteReport = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/reports/${id}`, { method: "DELETE" });
      if (res.ok) fetchReports();
    } catch (err) {
      console.error("Failed to delete report:", err);
    }
  }, [fetchReports]);

  const handleCsvUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsBulkProcessing(true);
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: async (results) => {
        // Normalize headers to lowercase for easier matching
        const rawData = results.data as any[];
        const data = rawData.map(row => {
          const normalizedRow: any = {};
          if (row && typeof row === 'object') {
            Object.keys(row).forEach(key => {
              const val = row[key];
              if (val !== undefined && val !== null) {
                // Remove spaces and underscores for better matching
                normalizedRow[key.toLowerCase().trim().replace(/[\s_]/g, '')] = val;
              }
            });
          }
          return normalizedRow;
        }).filter(row => (row.name || row.athletename) && (row.sport || row.activity));

        const total = data.length;
        if (total === 0) {
          alert("No valid athlete data found in CSV. Expected headers: name, sport, age, heartRate, bloodPressure, testosterone, hematocrit, weightChange, symptoms.");
          setIsBulkProcessing(false);
          return;
        }

        setProcessingProgress({ current: 0, total });

        const processedReports: any[] = [];
        const CHUNK_SIZE = 20; // Maximized concurrency for ultra-fast processing
        
        for (let i = 0; i < data.length; i += CHUNK_SIZE) {
          const chunk = data.slice(i, i + CHUNK_SIZE);
          
          await Promise.all(chunk.map(async (row) => {
            const athleteName = row.name || row.athletename || "Unknown Athlete";
            const vitals = {
              heartRate: Number(row.heartrate || row.hr || 60),
              bloodPressure: String(row.bloodpressure || row.bp || "120/80"),
              testosterone: Number(row.testosterone || row.testo || 500),
              hematocrit: Number(row.hematocrit || row.hct || 45),
              weightChange: Number(row.weightchange || row.wtchange || 0),
              symptoms: String(row.symptoms || row.notes || "").trim()
            };

            // Instant ML Pre-classification (Zero latency with pre-allocated buffer)
            const mlStatus = classifyAthlete({
              age: Number(row.age || 25),
              heartRate: vitals.heartRate,
              testosterone: vitals.testosterone,
              hematocrit: vitals.hematocrit,
              weightChange: vitals.weightChange
            });

            try {
              let analysis = "";
              let status = mlStatus;

              // Ultra-fast path: Skip AI for healthy athletes with no symptoms
              const hasSymptoms = vitals.symptoms && 
                                vitals.symptoms.toLowerCase() !== "none" && 
                                vitals.symptoms.toLowerCase() !== "none reported" && 
                                vitals.symptoms.length > 2;

              if (mlStatus !== 'Ready' || hasSymptoms) {
                const aiResult = await analyzeAthleteHealth({
                  name: athleteName,
                  age: Number(row.age || 25),
                  sport: String(row.sport || row.activity || "Unknown"),
                  vitals
                });
                analysis = aiResult.analysis;
                status = aiResult.status;
              } else {
                analysis = `**[Nexus ML Instant Analysis]**\n\nPhysiological markers are optimal. No risks detected.`;
              }

              processedReports.push({
                athlete_name: athleteName,
                age: Number(row.age || 25),
                sport: String(row.sport || row.activity || "Unknown"),
                vitals,
                analysis,
                status
              });
            } catch (err: any) {
              console.error(`Error processing ${athleteName}:`, err);
              if (err?.message?.includes("entity was not found")) {
                setHasApiKey(false);
              }
            } finally {
              setProcessingProgress(prev => ({ ...prev, current: prev.current + 1 }));
            }
          }));

          // Sync in large batches of 100 for maximum database efficiency
          if (processedReports.length >= 100 || i + CHUNK_SIZE >= data.length) {
            await fetch("/api/reports/bulk", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(processedReports.splice(0, processedReports.length)),
            });
          }
        }

        setIsBulkProcessing(false);
        setProcessingProgress({ current: 0, total: 0 });
        fetchReports();
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }, [fetchReports]);

  const handleAddNote = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.title.trim()) return;

    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newNote),
      });
      if (res.ok) {
        setNewNote({ title: "", content: "", category: "General" });
        setIsAddingNote(false);
        fetchNotes();
      }
    } catch (err) {
      console.error("Failed to add note:", err);
    }
  }, [newNote, fetchNotes]);

  const handleDeleteNote = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/notes/${id}`, { method: "DELETE" });
      if (res.ok) fetchNotes();
    } catch (err) {
      console.error("Failed to delete note:", err);
    }
  }, [fetchNotes]);

  const handleSendMessage = useCallback(async () => {
    if (!inputMessage.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { role: "user", content: inputMessage };
    setChatMessages(prev => [...prev, userMsg]);
    setInputMessage("");
    setIsChatLoading(true);

    try {
      const aiResponse = await getGeminiResponse(inputMessage);
      setChatMessages(prev => [...prev, { role: "assistant", content: aiResponse }]);
    } catch (err: any) {
      console.error("Chat error:", err);
      if (err?.message?.includes("entity was not found")) {
        setHasApiKey(false);
      }
      setChatMessages(prev => [...prev, { role: "assistant", content: "Sorry, I encountered an error. Please try again." }]);
    } finally {
      setIsChatLoading(false);
    }
  }, [inputMessage, isChatLoading]);

  const filteredNotes = useMemo(() => {
    if (!searchQuery.trim()) return notes;
    const q = searchQuery.toLowerCase();
    return notes.filter(n => n.title.toLowerCase().includes(q) || n.content.toLowerCase().includes(q) || n.category.toLowerCase().includes(q));
  }, [notes, searchQuery]);

  const filteredReports = useMemo(() => {
    if (!searchQuery.trim()) return reports;
    const q = searchQuery.toLowerCase();
    return reports.filter(r => r.athlete_name.toLowerCase().includes(q) || r.sport.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
  }, [reports, searchQuery]);

  return (
    <div className="flex h-screen w-full overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-20 lg:w-64 bg-bg-surface border-r border-white/5 flex flex-col items-center lg:items-stretch py-8 px-4 z-20">
        <div className="flex items-center gap-3 px-2 mb-12">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-primary to-indigo-400 flex items-center justify-center shadow-lg shadow-brand-primary/20 animate-float">
            <Sparkles className="text-white w-6 h-6" />
          </div>
          <h1 className="hidden lg:block text-2xl font-display font-bold tracking-tight text-gradient">Nexus Pro</h1>
        </div>

        <nav className="flex-1 space-y-2">
          <SidebarItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={activeTab === "dashboard"} 
            onClick={() => setActiveTab("dashboard")} 
          />
          <SidebarItem 
            icon={<StickyNote size={20} />} 
            label="Notes" 
            active={activeTab === "notes"} 
            onClick={() => setActiveTab("notes")} 
          />
          <SidebarItem 
            icon={<MessageSquare size={20} />} 
            label="AI Assistant" 
            active={activeTab === "chat"} 
            onClick={() => setActiveTab("chat")} 
          />
          <SidebarItem 
            icon={<HeartPulse size={20} />} 
            label="Athlete Intel" 
            active={activeTab === "analysis"} 
            onClick={() => setActiveTab("analysis")} 
          />
        </nav>

        <div className="mt-auto pt-8 border-t border-white/5">
          <SidebarItem icon={<Settings size={20} />} label="Settings" />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-y-auto bg-bg-main relative custom-scrollbar">
        <header className="sticky top-0 z-10 bg-bg-surface/80 backdrop-blur-xl px-8 py-4 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-4 bg-white/[0.03] px-4 py-2 rounded-full border border-white/5 w-96 group focus-within:border-brand-primary/30 transition-all">
            <Search size={18} className="text-zinc-500 group-focus-within:text-brand-primary transition-colors" />
            <input 
              type="text" 
              placeholder="Search your workspace..." 
              className="bg-transparent border-none outline-none text-sm w-full placeholder:text-zinc-600 text-zinc-200"
            />
          </div>
          <div className="flex items-center gap-4">
            {!hasApiKey && (
              <button 
                onClick={handleOpenKeySelector}
                className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-widest hover:bg-amber-500/20 transition-all flex items-center gap-2"
              >
                <AlertTriangle size={14} />
                Select API Key
              </button>
            )}
            <button 
              onClick={() => activeTab === "analysis" ? setIsAnalyzing(true) : setIsAddingNote(true)}
              className="btn-primary px-5 py-2.5 rounded-full text-sm font-bold flex items-center gap-2"
            >
              <Plus size={18} />
              {activeTab === "analysis" ? "New Analysis" : "New Note"}
            </button>
            <div className="w-10 h-10 rounded-full bg-zinc-800 border border-white/10 overflow-hidden ring-2 ring-white/5 ring-offset-2 ring-offset-bg-main">
              <img src="https://picsum.photos/seed/user/100/100" alt="User" referrerPolicy="no-referrer" />
            </div>
          </div>
        </header>

        <div className="p-8 max-w-7xl mx-auto">
          <AnimatePresence mode="wait">
            {activeTab === "dashboard" && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <section>
                  <h2 className="text-4xl font-display font-bold mb-2 text-gradient">Welcome back, Creative.</h2>
                  <p className="text-zinc-500 font-medium">Here's what's happening in your workspace today.</p>
                </section>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard label="Total Notes" value={notes.length.toString()} icon={<StickyNote className="text-indigo-400" />} />
                  <StatCard label="Health Reports" value={reports.length.toString()} icon={<Activity className="text-rose-400" />} />
                  <StatCard label="AI Interactions" value="12" icon={<MessageSquare className="text-emerald-400" />} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <div className="glass-card rounded-[2rem] p-8 space-y-6">
                    <div className="flex items-center justify-between">
                      <h3 className="text-xl font-display font-semibold">Recent Notes</h3>
                      <button onClick={() => setActiveTab("notes")} className="text-brand-primary text-sm font-semibold hover:text-indigo-400 transition-colors">View all</button>
                    </div>
                    <div className="space-y-4">
                      {notes.slice(0, 3).map(note => (
                        <div key={note.id} className="flex items-center justify-between p-4 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/10 hover:bg-white/[0.04] transition-all group cursor-pointer">
                          <div className="flex items-center gap-4">
                            <div className="w-2.5 h-2.5 rounded-full bg-brand-primary shadow-[0_0_10px_rgba(99,102,241,0.5)]" />
                            <div>
                              <p className="text-sm font-semibold text-zinc-200">{note.title}</p>
                              <p className="text-xs text-zinc-500 font-medium">{new Date(note.created_at).toLocaleDateString()}</p>
                            </div>
                          </div>
                          <ChevronRight size={18} className="text-zinc-600 group-hover:text-zinc-300 group-hover:translate-x-1 transition-all" />
                        </div>
                      ))}
                      {notes.length === 0 && <p className="text-zinc-600 text-sm italic py-4">No notes yet. Create one to get started.</p>}
                    </div>
                  </div>

                  <div className="glass-card rounded-[2rem] p-8 flex flex-col">
                    <h3 className="text-xl font-display font-semibold mb-6">Quick AI Brainstorm</h3>
                    <div className="flex-1 bg-black/40 rounded-2xl p-6 mb-6 text-sm text-zinc-400 italic leading-relaxed border border-white/5">
                      "Nexus, can you help me outline a new project for a minimalist workspace app?"
                    </div>
                    <button 
                      onClick={() => setActiveTab("chat")}
                      className="w-full py-4 rounded-2xl bg-white/[0.03] border border-white/10 text-sm font-bold text-zinc-200 hover:bg-white/[0.06] transition-all flex items-center justify-center gap-3 group"
                    >
                      <Sparkles size={18} className="text-brand-primary group-hover:scale-110 transition-transform" />
                      Open Assistant
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "notes" && (
              <motion.div 
                key="notes"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="text-2xl font-semibold">Your Notes</h2>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                      <input 
                        type="text"
                        placeholder="Search notes..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="bg-white/5 border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm outline-none focus:border-indigo-500/50 transition-all w-64"
                      />
                      {searchQuery && (
                        <button 
                          onClick={() => setSearchQuery("")}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white"
                        >
                          <Plus size={14} className="rotate-45" />
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button className="p-2 rounded-lg glass-hover"><Clock size={20} className="text-zinc-400" /></button>
                      <button className="p-2 rounded-lg glass-hover"><Tag size={20} className="text-zinc-400" /></button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                  {filteredNotes.map(note => (
                    <NoteCard key={note.id} note={note} onDelete={() => handleDeleteNote(note.id)} />
                  ))}
                  {!searchQuery && (
                    <button 
                      onClick={() => setIsAddingNote(true)}
                      className="h-64 rounded-3xl border-2 border-dashed border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all flex flex-col items-center justify-center gap-3 group"
                    >
                      <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition-all">
                        <Plus size={24} />
                      </div>
                      <span className="text-zinc-500 font-medium group-hover:text-zinc-300">Add New Note</span>
                    </button>
                  )}
                </div>
                {filteredNotes.length === 0 && (
                  <div className="text-center py-20 glass rounded-3xl border-dashed">
                    <StickyNote size={48} className="mx-auto text-zinc-700 mb-4" />
                    <p className="text-zinc-500">
                      {searchQuery ? `No notes found matching "${searchQuery}"` : "Your workspace is empty. Create your first note to begin."}
                    </p>
                    {searchQuery && (
                      <button onClick={() => setSearchQuery("")} className="mt-4 text-indigo-400 text-sm hover:underline">Clear search</button>
                    )}
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === "chat" && (
              <motion.div 
                key="chat"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="h-[calc(100vh-12rem)] flex flex-col glass-card rounded-[2.5rem] overflow-hidden border border-white/5"
              >
                <div className="p-6 border-b border-white/5 flex items-center justify-between bg-white/[0.02]">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-primary to-indigo-400 flex items-center justify-center shadow-lg shadow-brand-primary/20">
                      <Sparkles size={20} className="text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-zinc-100">Nexus Assistant</h3>
                      <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-widest flex items-center gap-1.5 mt-0.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        Online
                      </p>
                    </div>
                  </div>
                  <button className="p-2.5 rounded-xl hover:bg-white/5 transition-all"><MoreVertical size={20} className="text-zinc-500" /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                  {chatMessages.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center text-center space-y-6">
                      <div className="w-20 h-20 rounded-[2rem] bg-white/[0.03] flex items-center justify-center mb-2 border border-white/5">
                        <MessageSquare size={40} className="text-brand-primary" />
                      </div>
                      <h4 className="text-2xl font-display font-bold text-gradient">How can I help you today?</h4>
                      <p className="text-sm text-zinc-500 max-w-xs font-medium leading-relaxed">Brainstorm ideas, summarize your notes, or just chat about your creative process.</p>
                      <div className="flex flex-wrap justify-center gap-3 mt-4">
                        <QuickAction label="Summarize my notes" onClick={() => setInputMessage("Can you summarize my recent notes?")} />
                        <QuickAction label="Brainstorm project ideas" onClick={() => setInputMessage("I need some ideas for a new creative project.")} />
                      </div>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                      <div className={cn(
                        "max-w-[80%] p-5 rounded-2xl text-sm leading-relaxed",
                        msg.role === "user" ? "bg-brand-primary text-white shadow-lg shadow-brand-primary/20" : "bg-white/[0.03] border border-white/5 text-zinc-200"
                      )}>
                        <div className="prose prose-invert prose-sm max-w-none">
                          <ReactMarkdown>
                            {msg.content}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  ))}
                  {isChatLoading && (
                    <div className="flex justify-start">
                      <div className="bg-white/[0.03] border border-white/5 p-5 rounded-2xl flex gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:0.2s]" />
                        <span className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce [animation-delay:0.4s]" />
                      </div>
                    </div>
                  )}
                  <div ref={chatEndRef} />
                </div>

                <div className="p-6 bg-white/[0.02] border-t border-white/5">
                  <div className="relative">
                    <input 
                      type="text" 
                      value={inputMessage}
                      onChange={(e) => setInputMessage(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleSendMessage()}
                      placeholder="Type your message..."
                      className="w-full bg-black/40 border border-white/10 rounded-2xl py-4.5 pl-6 pr-16 outline-none focus:border-brand-primary/50 transition-all text-sm text-zinc-200 placeholder:text-zinc-600"
                    />
                    <button 
                      onClick={handleSendMessage}
                      disabled={!inputMessage.trim() || isChatLoading}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 w-11 h-11 rounded-xl bg-brand-primary flex items-center justify-center text-white hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-brand-primary/20"
                    >
                      <Send size={20} />
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "analysis" && (
              <motion.div 
                key="analysis"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-6">
                    <h2 className="text-3xl font-display font-bold text-gradient">Athlete Intelligence</h2>
                    {isBulkProcessing && (
                      <div className="flex items-center gap-3 px-4 py-1.5 rounded-full bg-brand-primary/10 border border-brand-primary/20">
                        <Loader2 size={14} className="text-brand-primary animate-spin" />
                        <span className="text-[10px] font-bold text-brand-primary uppercase tracking-widest">
                          Processing {processingProgress.current}/{processingProgress.total}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="relative group">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-brand-primary transition-colors" size={18} />
                      <input 
                        type="text"
                        placeholder="Search athletes..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="bg-white/[0.03] border border-white/10 rounded-full py-2.5 pl-12 pr-10 text-sm outline-none focus:border-brand-primary/50 transition-all w-72 text-zinc-200 placeholder:text-zinc-600"
                      />
                      {searchQuery && (
                        <button 
                          onClick={() => setSearchQuery("")}
                          className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                        >
                          <Plus size={16} className="rotate-45" />
                        </button>
                      )}
                    </div>
                    <input 
                      type="file" 
                      ref={fileInputRef}
                      onChange={handleCsvUpload}
                      accept=".csv"
                      className="hidden"
                    />
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isBulkProcessing}
                      className="text-sm font-bold uppercase tracking-widest text-zinc-500 hover:text-zinc-200 flex items-center gap-3 px-5 py-2.5 rounded-2xl bg-white/[0.03] border border-white/10 hover:bg-white/[0.06] transition-all disabled:opacity-50"
                    >
                      {isBulkProcessing ? (
                        <div className="flex flex-col items-start">
                          <div className="flex items-center gap-2">
                            <Loader2 size={16} className="animate-spin" />
                            <span>{Math.round((processingProgress.current / processingProgress.total) * 100)}%</span>
                          </div>
                          <div className="w-24 h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
                            <div 
                              className="h-full bg-brand-primary transition-all duration-300" 
                              style={{ width: `${(processingProgress.current / processingProgress.total) * 100}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <>
                          <Upload size={18} />
                          <span>Import CSV</span>
                        </>
                      )}
                    </button>
                    <button 
                      onClick={() => setIsAnalyzing(true)}
                      className="btn-primary px-6 py-2.5 rounded-2xl text-sm font-bold flex items-center gap-3"
                    >
                      <Plus size={20} />
                      New Analysis
                    </button>
                  </div>
                </div>

                <div className="space-y-6">
                  {filteredReports.map(report => (
                    <ReportCard key={report.id} report={report} onDelete={() => handleDeleteReport(report.id)} />
                  ))}
                  {filteredReports.length === 0 && (
                    <div className="glass-card rounded-[3rem] p-20 text-center space-y-6 border border-white/5">
                      <div className="w-24 h-24 rounded-[2rem] bg-white/[0.03] flex items-center justify-center mx-auto border border-white/5">
                        <FileText className="text-zinc-700" size={48} />
                      </div>
                      <div className="max-w-xs mx-auto">
                        <h3 className="text-2xl font-display font-bold text-zinc-200">No reports found</h3>
                        <p className="text-sm text-zinc-500 font-medium leading-relaxed mt-2">
                          {searchQuery ? `No athletes match your search "${searchQuery}"` : "Start by running a new health analysis or importing a CSV file."}
                        </p>
                      </div>
                      {searchQuery ? (
                        <button onClick={() => setSearchQuery("")} className="text-brand-primary text-sm font-bold uppercase tracking-widest hover:text-indigo-400 transition-colors">Clear search</button>
                      ) : (
                        <button 
                          onClick={() => setIsAnalyzing(true)}
                          className="px-8 py-3 rounded-2xl bg-white/[0.03] border border-white/10 text-sm font-bold uppercase tracking-widest text-zinc-300 hover:bg-white/[0.06] transition-all"
                        >
                          Run First Analysis
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Analysis Modal */}
      <AnimatePresence>
        {isAnalyzing && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isAnalysisLoading && setIsAnalyzing(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl glass-card rounded-[2.5rem] p-10 shadow-2xl my-8 border border-white/10"
            >
              <h3 className="text-2xl font-display font-bold mb-8 flex items-center gap-3 text-gradient">
                <Activity className="text-brand-primary" />
                Athlete Health Screening
              </h3>
              <form onSubmit={handleAnalyzeAthlete} className="space-y-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Athlete Name</label>
                    <input 
                      type="text" 
                      required
                      value={athleteData.name}
                      onChange={e => setAthleteData({...athleteData, name: e.target.value})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                      placeholder="e.g. John Doe"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Sport</label>
                    <input 
                      type="text" 
                      required
                      value={athleteData.sport}
                      onChange={e => setAthleteData({...athleteData, sport: e.target.value})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                      placeholder="e.g. Football"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Age</label>
                    <input 
                      type="number" 
                      value={athleteData.age || ""}
                      onChange={e => setAthleteData({...athleteData, age: e.target.value === "" ? 0 : parseInt(e.target.value)})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Heart Rate (bpm)</label>
                    <input 
                      type="number" 
                      value={athleteData.vitals.heartRate || ""}
                      onChange={e => setAthleteData({...athleteData, vitals: {...athleteData.vitals, heartRate: e.target.value === "" ? 0 : parseInt(e.target.value)}})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Blood Pressure</label>
                    <input 
                      type="text" 
                      value={athleteData.vitals.bloodPressure}
                      onChange={e => setAthleteData({...athleteData, vitals: {...athleteData.vitals, bloodPressure: e.target.value}})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                      placeholder="120/80"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Testosterone (ng/dL)</label>
                    <input 
                      type="number" 
                      value={athleteData.vitals.testosterone || ""}
                      onChange={e => setAthleteData({...athleteData, vitals: {...athleteData.vitals, testosterone: e.target.value === "" ? 0 : parseInt(e.target.value)}})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Hematocrit (%)</label>
                    <input 
                      type="number" 
                      value={athleteData.vitals.hematocrit || ""}
                      onChange={e => setAthleteData({...athleteData, vitals: {...athleteData.vitals, hematocrit: e.target.value === "" ? 0 : parseInt(e.target.value)}})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Weight Change (kg)</label>
                    <input 
                      type="number" 
                      value={athleteData.vitals.weightChange || ""}
                      onChange={e => setAthleteData({...athleteData, vitals: {...athleteData.vitals, weightChange: e.target.value === "" ? 0 : parseInt(e.target.value)}})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Reported Symptoms / Notes</label>
                  <textarea 
                    rows={3}
                    value={athleteData.vitals.symptoms}
                    onChange={e => setAthleteData({...athleteData, vitals: {...athleteData.vitals, symptoms: e.target.value}})}
                    placeholder="e.g., Rapid muscle gain, mood swings, acne, fatigue..."
                    className="w-full glass-input rounded-2xl py-4 px-5 text-sm resize-none"
                  />
                </div>

                <div className="flex gap-4 pt-6">
                  <button 
                    type="button"
                    disabled={isAnalysisLoading}
                    onClick={() => setIsAnalyzing(false)}
                    className="btn-secondary flex-1 py-4 rounded-2xl font-bold text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    disabled={isAnalysisLoading}
                    className="btn-primary flex-1 py-4 rounded-2xl font-bold text-sm flex items-center justify-center gap-3"
                  >
                    {isAnalysisLoading ? (
                      <>
                        <Loader2 size={20} className="animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      <>
                        <Sparkles size={20} />
                        Run AI Screening
                      </>
                    )}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add Note Modal */}
      <AnimatePresence>
        {isAddingNote && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingNote(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg glass-card rounded-[2.5rem] p-10 shadow-2xl border border-white/10"
            >
              <h3 className="text-2xl font-display font-bold mb-8 text-gradient">Create New Note</h3>
              <form onSubmit={handleAddNote} className="space-y-6">
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Title</label>
                  <input 
                    autoFocus
                    type="text" 
                    value={newNote.title}
                    onChange={e => setNewNote({...newNote, title: e.target.value})}
                    placeholder="Note title..."
                    className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Category</label>
                  <div className="relative">
                    <select 
                      value={newNote.category}
                      onChange={e => setNewNote({...newNote, category: e.target.value})}
                      className="w-full glass-input rounded-2xl py-3.5 px-5 text-sm appearance-none cursor-pointer"
                    >
                      <option value="General">General</option>
                      <option value="Work">Work</option>
                      <option value="Personal">Personal</option>
                      <option value="Ideas">Ideas</option>
                    </select>
                    <ChevronRight className="absolute right-4 top-1/2 -translate-y-1/2 rotate-90 text-zinc-500 pointer-events-none" size={16} />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-2 block">Content</label>
                  <textarea 
                    rows={6}
                    value={newNote.content}
                    onChange={e => setNewNote({...newNote, content: e.target.value})}
                    placeholder="Write your thoughts here..."
                    className="w-full glass-input rounded-2xl py-4 px-5 text-sm resize-none"
                  />
                </div>
                <div className="flex gap-4 pt-6">
                  <button 
                    type="button"
                    onClick={() => setIsAddingNote(false)}
                    className="btn-secondary flex-1 py-4 rounded-2xl font-bold text-sm"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="btn-primary flex-1 py-4 rounded-2xl font-bold text-sm"
                  >
                    Save Note
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

const SidebarItem = memo(({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick?: () => void }) => {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all group relative",
        active ? "bg-brand-primary text-white shadow-lg shadow-brand-primary/20" : "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
      )}
    >
      {active && (
        <motion.div 
          layoutId="sidebar-active"
          className="absolute inset-0 bg-brand-primary rounded-xl -z-10"
          transition={{ type: "spring", bounce: 0.2, duration: 0.6 }}
        />
      )}
      <span className={cn("transition-transform group-hover:scale-110", active ? "text-white" : "text-zinc-500")}>{icon}</span>
      <span className="hidden lg:block text-sm font-bold tracking-tight">{label}</span>
    </button>
  );
});

const StatCard = memo(({ label, value, icon }: { label: string, value: string, icon: React.ReactNode }) => {
  return (
    <div className="glass-card rounded-[2rem] p-8 flex items-center gap-6 group hover:border-white/10 transition-all">
      <div className="w-14 h-14 rounded-2xl bg-white/[0.03] flex items-center justify-center group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div>
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
        <p className="text-3xl font-display font-bold text-gradient">{value}</p>
      </div>
    </div>
  );
});

const NoteCard = memo(({ note, onDelete }: { note: Note, onDelete: () => void }) => {
  return (
    <motion.div 
      layout
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="glass-card rounded-[2rem] p-8 h-72 flex flex-col group relative overflow-hidden hover:border-white/10 transition-all"
    >
      <div className="absolute top-0 right-0 p-6 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={onDelete} className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all">
          <Trash2 size={18} />
        </button>
      </div>
      <div className="flex items-center gap-2 mb-4">
        <span className="px-3 py-1 rounded-full bg-brand-primary/10 text-brand-primary text-[10px] font-bold uppercase tracking-widest border border-brand-primary/20">
          {note.category}
        </span>
      </div>
      <h3 className="text-xl font-display font-bold mb-3 line-clamp-1 text-zinc-100">{note.title}</h3>
      <p className="text-sm text-zinc-500 line-clamp-4 flex-1 leading-relaxed">{note.content}</p>
      <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
          {new Date(note.created_at).toLocaleDateString()}
        </span>
        <button className="text-zinc-500 hover:text-white transition-colors">
          <ChevronRight size={18} />
        </button>
      </div>
    </motion.div>
  );
});

const QuickAction = memo(({ label, onClick }: { label: string, onClick: () => void }) => {
  return (
    <button 
      onClick={onClick}
      className="px-4 py-2 rounded-full bg-white/[0.03] border border-white/10 text-[10px] font-bold uppercase tracking-widest text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 transition-all"
    >
      {label}
    </button>
  );
});

const ReportCard = memo(({ report, onDelete }: { report: HealthReport, onDelete: () => void }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const vitals = useMemo(() => {
    let v = {
      heartRate: 0,
      bloodPressure: "N/A",
      testosterone: 0,
      hematocrit: 0,
      weightChange: 0,
      symptoms: "N/A"
    };

    try {
      if (typeof report.vitals === 'string') {
        v = JSON.parse(report.vitals);
      } else if (report.vitals && typeof report.vitals === 'object') {
        v = report.vitals;
      }
    } catch (e) {
      console.error("Failed to parse vitals for report:", report.id, e);
    }
    return v;
  }, [report.vitals, report.id]);

  const statusConfig = useMemo(() => ({
    Ready: { icon: <CheckCircle2 className="text-emerald-400" />, bg: "bg-emerald-500/10", border: "border-emerald-500/20", text: "text-emerald-400", label: "Ready to Play" },
    Caution: { icon: <AlertTriangle className="text-amber-400" />, bg: "bg-amber-500/10", border: "border-amber-500/20", text: "text-amber-400", label: "Medical Caution" },
    Suspicious: { icon: <ShieldAlert className="text-rose-400" />, bg: "bg-rose-500/10", border: "border-rose-500/20", text: "text-rose-400", label: "Suspicious Activity" }
  }), []);

  const config = statusConfig[report.status] || statusConfig.Caution;

  return (
    <motion.div layout className="glass-card rounded-[2rem] overflow-hidden border border-white/5 hover:border-white/10 transition-all">
      <div className="p-8 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <div className={cn("w-14 h-14 rounded-2xl flex items-center justify-center", config.bg)}>
            {config.icon}
          </div>
          <div>
            <h3 className="text-xl font-display font-bold text-zinc-100">{report.athlete_name}</h3>
            <p className="text-xs text-zinc-500 font-bold uppercase tracking-widest mt-1">{report.sport} • Age {report.age}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className={cn("px-4 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest border", config.bg, config.text, config.border)}>
            {config.label}
          </div>
          <button onClick={() => setIsExpanded(!isExpanded)} className="p-2.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.06] transition-all">
            <ChevronRight className={cn("text-zinc-500 transition-transform", isExpanded && "rotate-90")} />
          </button>
          <button onClick={onDelete} className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all">
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div 
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-white/5 bg-black/40"
          >
            <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-12">
              <div className="space-y-6">
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 pb-2">Key Vitals</h4>
                <div className="grid grid-cols-2 gap-4">
                  <VitalItem label="Heart Rate" value={`${vitals.heartRate} bpm`} />
                  <VitalItem label="BP" value={vitals.bloodPressure} />
                  <VitalItem label="Testosterone" value={`${vitals.testosterone} ng/dL`} />
                  <VitalItem label="Hematocrit" value={`${vitals.hematocrit}%`} />
                </div>
              </div>
              <div className="md:col-span-2 space-y-6">
                <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest border-b border-white/5 pb-2">AI Medical Analysis</h4>
                <div className="prose prose-invert prose-sm max-w-none text-zinc-400 leading-relaxed">
                  <ReactMarkdown>{report.analysis}</ReactMarkdown>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

const VitalItem = memo(({ label, value }: { label: string, value: string }) => {
  return (
    <div className="bg-white/[0.02] p-4 rounded-2xl border border-white/5 hover:bg-white/[0.04] transition-all">
      <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{label}</p>
      <p className="text-sm font-bold text-zinc-200">{value}</p>
    </div>
  );
});
