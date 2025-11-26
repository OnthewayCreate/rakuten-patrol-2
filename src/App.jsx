import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, FileText, CheckCircle, Play, Download, Loader2, ShieldAlert, Pause, Trash2, Eye, Zap, FolderOpen, Lock, LogOut, History, Settings, Save, Search, Globe, ShoppingBag, AlertCircle, RefreshCw, ExternalLink, Siren, User, Users, UserPlus, X, LayoutDashboard, ChevronRight, Calendar, Folder, FileSearch, ChevronDown, ArrowLeft, Store, Filter, Info, PlayCircle, Terminal, Activity, Cloud, LockKeyhole, ZapOff, Gauge, StopCircle, ImageIcon, Bot } from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, where, getDocs, deleteDoc, doc, updateDoc, setDoc, getDoc } from 'firebase/firestore';

/**
 * ============================================================================
 * System Configuration & Utilities
 * ============================================================================
 */
const APP_CONFIG = {
  FIXED_PASSWORD: 'admin123',
  API_TIMEOUT: 30000,
  RETRY_LIMIT: 8,
  VERSION: '10.1.1-FixBugs'
};

const parseCSV = (text) => {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') { currentField += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField); currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField); currentField = '';
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
    } else { currentField += char; }
  }
  if (currentField || currentRow.length > 0) { currentRow.push(currentField); rows.push(currentRow); }
  return rows;
};

const readFileAsText = (file, encoding) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file, encoding);
  });
};

const parseFirebaseConfig = (input) => {
  if (!input) return null;
  try {
    return JSON.parse(input);
  } catch (e) {
    try {
      let jsonStr = input
        .replace(/^(const|var|let)\s+\w+\s*=\s*/, '')
        .replace(/;\s*$/, '')
        .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
        .replace(/'/g, '"');
      return JSON.parse(jsonStr);
    } catch (e2) {
      console.error("Config Parse Error", e2);
      return null;
    }
  }
};

// --- Service: AI Analysis API Wrapper ---
async function analyzeItemRisk(itemData, apiKey, retryCount = 0) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), APP_CONFIG.API_TIMEOUT);

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName: itemData.productName,
        imageUrl: itemData.imageUrl, 
        apiKey: apiKey
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.status === 429 || response.status >= 500) {
      if (retryCount < APP_CONFIG.RETRY_LIMIT) {
        const waitTime = Math.pow(2, retryCount) * 1000 + (Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return analyzeItemRisk(itemData, apiKey, retryCount + 1);
      } else {
        throw new Error("Server Busy (Rate Limit)");
      }
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API Error: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    return { risk_level: "エラー", reason: error.message === 'Aborted' ? 'タイムアウト' : error.message };
  }
}

/**
 * ============================================================================
 * UI Components (Designer Edition)
 * ============================================================================
 */

const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 pointer-events-none">
    {toasts.map((toast) => (
      <div key={toast.id} className={`pointer-events-auto min-w-[320px] p-4 rounded-xl shadow-2xl text-white flex justify-between items-center animate-in slide-in-from-right fade-in duration-300 border border-white/10 backdrop-blur-md ${toast.type === 'error' ? 'bg-red-600/90' : toast.type === 'success' ? 'bg-emerald-600/90' : 'bg-slate-800/90'}`}>
        <span className="text-sm font-medium tracking-wide">{toast.message}</span>
        <button onClick={() => removeToast(toast.id)} className="hover:bg-white/20 p-1 rounded-full transition-colors"><X className="w-4 h-4" /></button>
      </div>
    ))}
  </div>
);

const RiskBadge = ({ item }) => {
  const { risk, isCritical, is_critical } = item;
  if (isCritical || is_critical) return <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 items-center gap-1.5 shadow-sm whitespace-nowrap"><Siren className="w-3 h-3"/> 重大</span>;
  if (risk === '高' || risk === 'High') return <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 whitespace-nowrap">高</span>;
  if (risk === '中' || risk === 'Medium') return <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 border border-amber-200 whitespace-nowrap">中</span>;
  return <span className="inline-flex px-3 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-700 border border-emerald-200 whitespace-nowrap">低</span>;
};

const StatCard = ({ title, value, icon: Icon, color, onClick }) => (
  <div 
    onClick={onClick}
    className={`bg-white p-6 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-5 transition-all group ${onClick ? 'cursor-pointer hover:shadow-md hover:-translate-y-0.5' : ''}`}
  >
    <div className={`p-4 rounded-2xl ${color} bg-opacity-10 group-hover:scale-110 transition-transform duration-300`}>
      <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
    </div>
    <div>
      <p className="text-xs text-slate-400 font-bold uppercase tracking-wider mb-1">{title}</p>
      <p className="text-3xl font-bold text-slate-800 tracking-tight">{value}</p>
    </div>
  </div>
);

const NavButton = ({ icon: Icon, label, id, active, onClick }) => (
  <button
    onClick={() => onClick(id)}
    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 ${active === id ? 'bg-blue-50 text-blue-700 shadow-sm translate-x-1' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'}`}
  >
    <Icon className={`w-5 h-5 ${active === id ? 'text-blue-600' : 'text-slate-400'}`} />
    {label}
    {active === id && <ChevronRight className="w-4 h-4 ml-auto text-blue-400" />}
  </button>
);

const SessionStatusBadge = ({ status }) => {
  if (status === 'completed') return <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2.5 py-0.5 rounded-full font-bold border border-emerald-200">完了</span>;
  if (status === 'processing') return <span className="text-[10px] bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full font-bold border border-blue-200 flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin"/> 検査中</span>;
  if (status === 'aborted' || status === 'paused') return <span className="text-[10px] bg-slate-100 text-slate-600 px-2.5 py-0.5 rounded-full font-bold border border-slate-200">中断</span>;
  return <span className="text-[10px] bg-slate-50 text-slate-400 px-2.5 py-0.5 rounded-full border border-slate-200">{status || '不明'}</span>;
};

// --- Views ---

const LoginView = ({ onLogin }) => {
  const [id, setId] = useState('');
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin(id.trim(), pass.trim());
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="bg-white p-10 rounded-3xl shadow-xl max-w-sm w-full border border-slate-100">
        <div className="text-center mb-10">
          <div className="inline-flex p-5 bg-gradient-to-tr from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-200 mb-6 transform hover:scale-105 transition-transform duration-500">
            <Bot className="w-12 h-12 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800 tracking-tight">Rakuten Patrol <span className="text-blue-600">Pro</span></h1>
          <p className="text-sm text-slate-500 mt-3 font-medium leading-relaxed">AI弁理士による<br/>知的財産権侵害チェックシステム</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">ID</label>
            <div className="relative group">
              <User className="w-5 h-5 absolute left-4 top-3.5 text-slate-300 group-focus-within:text-blue-500 transition-colors" />
              <input type="text" value={id} onChange={e => setId(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium text-slate-700" placeholder="ユーザーID" required />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider pl-1">Password</label>
            <div className="relative group">
              <Lock className="w-5 h-5 absolute left-4 top-3.5 text-slate-300 group-focus-within:text-blue-500 transition-colors" />
              <input type="password" value={pass} onChange={e => setPass(e.target.value)} className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none transition-all font-medium text-slate-700" placeholder="パスワード" required />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-slate-900 text-white py-4 rounded-xl font-bold hover:bg-slate-800 active:scale-[0.98] transition-all shadow-lg disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2 mt-4">
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : "システムにログイン"}
          </button>
        </form>
      </div>
    </div>
  );
};

// --- ブラッシュアップされた結果テーブル ---
const ResultTableWithTabs = ({ items, currentUser, title, onBack, showDownload = true }) => {
  const [filter, setFilter] = useState('all'); 

  const filteredItems = useMemo(() => {
    if (filter === 'all') return items;
    if (filter === 'critical') return items.filter(i => i.isCritical || i.is_critical || i.risk === '高' || i.risk === 'High');
    if (filter === 'medium') return items.filter(i => i.risk === '中' || i.risk === 'Medium');
    if (filter === 'low') return items.filter(i => i.risk === '低' || i.risk === 'Low');
    return items;
  }, [items, filter]);

  const counts = useMemo(() => {
    return {
      all: items.length,
      critical: items.filter(i => i.isCritical || i.is_critical || i.risk === '高' || i.risk === 'High').length,
      medium: items.filter(i => i.risk === '中' || i.risk === 'Medium').length,
      low: items.filter(i => i.risk === '低' || i.risk === 'Low').length,
    };
  }, [items]);

  const downloadCsv = () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let csvContent = "商品名,リスク,危険度,理由,担当者,商品URL,日時\n";
    filteredItems.forEach(r => {
      const name = `"${(r.productName || '').replace(/"/g, '""')}"`;
      const reason = `"${(r.reason || '').replace(/"/g, '""')}"`;
      const itemUrl = `"${(r.itemUrl || '').replace(/"/g, '""')}"`;
      const date = r.sessionDate ? new Date(r.sessionDate.seconds * 1000).toLocaleString() : new Date().toLocaleString();
      const critical = (r.isCritical || r.is_critical) ? "★重大★" : "";
      const user = r.sessionUser || currentUser?.name || '';
      csvContent += `${name},${r.risk},${critical},${reason},${user},${itemUrl},${date}\n`;
    });
    const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `report_${filter}_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-500">
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {onBack && (
            <button onClick={onBack} className="group text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1 bg-white px-4 py-2 rounded-lg border border-slate-200 shadow-sm hover:shadow transition-all">
              <ArrowLeft className="w-4 h-4 group-hover:-translate-x-1 transition-transform"/> 戻る
            </button>
          )}
          <div>
            <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <FileSearch className="w-6 h-6 text-blue-600"/>
              {title}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 ml-1">AI判定結果の詳細レポート</p>
          </div>
        </div>
        {showDownload && (
          <button onClick={downloadCsv} className="text-sm font-bold text-slate-600 hover:text-blue-600 hover:bg-blue-50 px-5 py-2.5 rounded-lg transition-all flex items-center gap-2 border border-slate-200 bg-white shadow-sm hover:border-blue-200">
            <Download className="w-4 h-4"/> 表示中をCSV出力
          </button>
        )}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2 px-1">
        <button onClick={() => setFilter('all')} className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${filter === 'all' ? 'bg-slate-800 text-white shadow-lg shadow-slate-200 scale-105' : 'bg-white text-slate-500 border border-slate-100 hover:bg-slate-50 hover:text-slate-700'}`}>
          すべて <span className="ml-1 opacity-70 text-xs font-normal">({counts.all})</span>
        </button>
        <button onClick={() => setFilter('critical')} className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all flex items-center gap-2 ${filter === 'critical' ? 'bg-red-600 text-white shadow-lg shadow-red-200 scale-105' : 'bg-white text-slate-500 border border-slate-100 hover:bg-red-50 hover:text-red-600'}`}>
          <Siren className="w-4 h-4"/> 重大・高 <span className="ml-1 opacity-70 text-xs font-normal">({counts.critical})</span>
        </button>
        <button onClick={() => setFilter('medium')} className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${filter === 'medium' ? 'bg-amber-500 text-white shadow-lg shadow-amber-200 scale-105' : 'bg-white text-slate-500 border border-slate-100 hover:bg-amber-50 hover:text-amber-600'}`}>
          中リスク <span className="ml-1 opacity-70 text-xs font-normal">({counts.medium})</span>
        </button>
        <button onClick={() => setFilter('low')} className={`px-5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap transition-all ${filter === 'low' ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200 scale-105' : 'bg-white text-slate-500 border border-slate-100 hover:bg-emerald-50 hover:text-emerald-600'}`}>
          低リスク <span className="ml-1 opacity-70 text-xs font-normal">({counts.low})</span>
        </button>
      </div>

      {/* Main Table Area */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="flex-1 overflow-y-auto">
           <table className="w-full text-left border-collapse">
             <thead className="bg-slate-50/80 backdrop-blur sticky top-0 z-10 border-b border-slate-200 shadow-sm">
               <tr>
                 <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider w-32 text-center">Risk Level</th>
                 <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider w-28 text-center">Image</th>
                 <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider min-w-[300px]">Item Details</th>
                 <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider w-1/3 min-w-[350px]">AI Analysis</th>
                 <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider w-32 text-center">Source</th>
               </tr>
             </thead>
             <tbody className="divide-y divide-slate-100">
               {filteredItems.map((item, idx) => (
                 <tr key={idx} className={`group transition-all duration-200 hover:bg-blue-50/30 ${item.isCritical || item.is_critical ? 'bg-red-50/30' : ''}`}>
                   
                   {/* Risk Badge */}
                   <td className="px-6 py-5 align-top text-center">
                     <RiskBadge item={item}/>
                   </td>

                   {/* Image Thumbnail */}
                   <td className="px-6 py-5 align-top">
                      <div className="relative w-20 h-20 mx-auto bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden group-hover:shadow-md transition-all group-hover:scale-105">
                        {item.imageUrl ? (
                          <a href={item.itemUrl} target="_blank" rel="noreferrer" className="block w-full h-full">
                            <img src={item.imageUrl} alt="" className="w-full h-full object-contain" />
                          </a>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300">
                            <ImageIcon className="w-6 h-6"/>
                          </div>
                        )}
                      </div>
                   </td>

                   {/* Product Name & Link */}
                   <td className="px-6 py-5 align-top">
                      <div className="font-bold text-slate-700 text-base leading-snug mb-2 group-hover:text-blue-700 transition-colors">
                        {item.productName}
                      </div>
                      {item.itemUrl && (
                        <a href={item.itemUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 bg-blue-50 px-2.5 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">
                          <ExternalLink className="w-3 h-3"/> 商品ページを開く
                        </a>
                      )}
                   </td>

                   {/* AI Reason */}
                   <td className="px-6 py-5 align-top">
                      {(item.isCritical || item.is_critical) && (
                        <div className="inline-flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-100 px-3 py-1.5 rounded-lg mb-2 border border-red-200">
                          <Siren className="w-3 h-3"/>
                          重大な権利侵害の疑いあり
                        </div>
                      )}
                      <div className="text-sm text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100">
                        {item.reason || "特記事項なし"}
                      </div>
                   </td>

                   {/* Source Info */}
                   <td className="px-6 py-5 align-top text-center">
                      {(item.source || item.sourceFile) && (item.source || item.sourceFile).startsWith('http') ? (
                        <div className="flex flex-col items-center gap-1">
                           <a href={item.source || item.sourceFile} target="_blank" rel="noreferrer" className="p-2 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 transition-colors" title="ショップへ">
                             <Store className="w-4 h-4"/>
                           </a>
                           <span className="text-[10px] text-slate-400">Shop</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                           <div className="p-2 bg-slate-50 text-slate-500 rounded-lg" title={item.source || item.sourceFile}>
                             <FileText className="w-4 h-4"/>
                           </div>
                           <span className="text-[10px] text-slate-400">CSV</span>
                        </div>
                      )}
                   </td>

                 </tr>
               ))}
               {filteredItems.length === 0 && (
                 <tr>
                   <td colSpan="5" className="py-20 text-center">
                     <div className="inline-flex p-4 bg-slate-50 rounded-full mb-3">
                       <Search className="w-6 h-6 text-slate-300"/>
                     </div>
                     <p className="text-slate-400 font-medium">該当する商品は見つかりませんでした</p>
                   </td>
                 </tr>
               )}
             </tbody>
           </table>
        </div>
      </div>
    </div>
  );
};

const DashboardView = ({ sessions, onNavigate, onResume, onForceStop, onInspectSession }) => {
  const [drillDownType, setDrillDownType] = useState(null); 

  const stats = useMemo(() => {
    let totalChecks = 0;
    let totalCritical = 0;
    let totalHigh = 0;
    let todayChecks = 0;
    
    const lists = { critical: [], high: [], today: [], all: [] };
    const now = new Date();

    sessions.forEach(session => {
      const isToday = session.createdAt && (() => {
        const d = new Date(session.createdAt.seconds * 1000);
        return d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
      })();

      totalChecks += (session.summary?.total || 0);
      totalCritical += (session.summary?.critical || 0);
      totalHigh += (session.summary?.high || 0);
      if (isToday) todayChecks += (session.summary?.total || 0);

      if (session.details) {
        session.details.forEach(item => {
          const enrichedItem = { ...item, sessionUser: session.user, sessionDate: session.createdAt, source: session.target, sourceType: session.type };
          lists.all.push(enrichedItem);
          if (item.isCritical || item.is_critical) lists.critical.push(enrichedItem);
          if (item.risk === '高' || item.risk === 'High') lists.high.push(enrichedItem);
          if (isToday) lists.today.push(enrichedItem);
        });
      }
    });
    const sortFn = (a, b) => (b.sessionDate?.seconds || 0) - (a.sessionDate?.seconds || 0);
    Object.values(lists).forEach(l => l.sort(sortFn));

    return { counts: { totalChecks, totalCritical, totalHigh, todayChecks }, lists };
  }, [sessions]);

  if (drillDownType) {
    return (
      <ResultTableWithTabs 
        title={
          drillDownType === 'critical' ? '重大な疑いのある商品' :
          drillDownType === 'high' ? '高リスク商品' :
          drillDownType === 'today' ? '本日の検査商品' : '全検査商品一覧'
        }
        items={stats.lists[drillDownType]}
        onBack={() => setDrillDownType(null)}
        showDownload={true}
      />
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-slate-800 tracking-tight">Dashboard</h2>
          <p className="text-slate-500 mt-1 font-medium">現在のパトロール状況サマリー</p>
        </div>
        <button onClick={() => onNavigate('url')} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold hover:bg-slate-800 shadow-lg shadow-slate-200 hover:shadow-xl transition-all flex items-center gap-2 active:scale-95">
          <Search className="w-5 h-5" /> 新規チェックを開始
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="本日の検査数" value={stats.counts.todayChecks} icon={RefreshCw} color="bg-blue-500 text-blue-500" onClick={() => setDrillDownType('today')} />
        <StatCard title="重大な疑い(累計)" value={stats.counts.totalCritical} icon={Siren} color="bg-purple-500 text-purple-500" onClick={() => setDrillDownType('critical')} />
        <StatCard title="高リスク(累計)" value={stats.counts.totalHigh} icon={AlertCircle} color="bg-red-500 text-red-500" onClick={() => setDrillDownType('high')} />
        <StatCard title="総検査商品数" value={stats.counts.totalChecks} icon={History} color="bg-slate-500 text-slate-500" onClick={() => setDrillDownType('all')} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg shadow-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-50 flex justify-between items-center">
          <h3 className="font-bold text-lg text-slate-700">最新の検査セッション</h3>
          <button onClick={() => onNavigate('history')} className="text-sm font-medium text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg transition-colors">履歴一覧へ</button>
        </div>
        <div className="divide-y divide-slate-50">
          {sessions.slice(0, 5).map((session) => (
            <div 
              key={session.id} 
              onClick={() => onInspectSession(session)}
              className="p-5 hover:bg-slate-50/80 transition-colors flex items-center justify-between group cursor-pointer"
            >
              <div className="flex items-center gap-5">
                <div className={`p-3 rounded-xl ${session.type === 'url' ? 'bg-blue-50 text-blue-600' : 'bg-emerald-50 text-emerald-600'}`}>
                  {session.type === 'url' ? <ShoppingBag className="w-6 h-6"/> : <FileText className="w-6 h-6"/>}
                </div>
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <p className="text-base font-bold text-slate-800 truncate max-w-md group-hover:text-blue-600 transition-colors">{session.target || '不明なターゲット'}</p>
                    {session.status === 'processing' && (
                       <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                         <button onClick={() => onResume(session)} className="text-[10px] bg-blue-600 text-white px-3 py-1 rounded-full hover:bg-blue-700 transition-colors font-bold flex items-center gap-1"><Play className="w-3 h-3"/> 再開</button>
                         <button onClick={() => onForceStop(session.id)} className="text-[10px] bg-slate-200 text-slate-600 px-3 py-1 rounded-full hover:bg-red-100 hover:text-red-600 transition-colors font-bold flex items-center gap-1"><StopCircle className="w-3 h-3"/> 停止</button>
                       </div>
                    )}
                  </div>
                  <div className="text-xs text-slate-400 flex gap-3">
                    <span className="flex items-center gap-1.5"><User className="w-3 h-3"/> {session.user}</span>
                    <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3"/> {session.createdAt ? new Date(session.createdAt.seconds * 1000).toLocaleString() : '-'}</span>
                    <SessionStatusBadge status={session.status} />
                  </div>
                </div>
              </div>
              <div className="flex gap-2 items-center">
                {session.summary?.critical > 0 && <span className="px-3 py-1 bg-purple-50 text-purple-700 text-xs font-bold rounded-lg flex items-center gap-1.5 border border-purple-100"><Siren className="w-3 h-3"/> {session.summary.critical}</span>}
                {session.summary?.high > 0 && <span className="px-3 py-1 bg-red-50 text-red-700 text-xs font-bold rounded-lg border border-red-100">高: {session.summary.high}</span>}
                <span className="px-3 py-1 bg-slate-50 text-slate-500 text-xs font-medium rounded-lg border border-slate-100">全: {session.summary?.total}</span>
                <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-blue-400 ml-2 transition-colors"/>
              </div>
            </div>
          ))}
          {sessions.length === 0 && <div className="p-12 text-center text-slate-400 font-medium">履歴がまだありません</div>}
        </div>
      </div>
    </div>
  );
};

const HistoryView = ({ sessions, onResume, onForceStop, onDelete, currentUser, inspectSession }) => {
  const [selectedSession, setSelectedSession] = useState(null);
  
  // Auto select session if passed via props
  useEffect(() => {
      if (inspectSession) setSelectedSession(inspectSession);
  }, [inspectSession]);

  const groupedSessions = useMemo(() => {
    const groups = {};
    sessions.forEach(session => {
      if (!session.createdAt) return;
      const date = new Date(session.createdAt.seconds * 1000);
      const monthKey = `${date.getFullYear()}年${date.getMonth() + 1}月`;
      const dayKey = `${date.getDate()}日`;
      
      if (!groups[monthKey]) groups[monthKey] = {};
      if (!groups[monthKey][dayKey]) groups[monthKey][dayKey] = [];
      groups[monthKey][dayKey].push(session);
    });
    return groups;
  }, [sessions]);

  const [expandedMonths, setExpandedMonths] = useState({});
  const [expandedDays, setExpandedDays] = useState({});

  const toggleMonth = (m) => setExpandedMonths(p => ({...p, [m]: !p[m]}));
  const toggleDay = (d) => setExpandedDays(p => ({...p, [d]: !p[d]}));

  if (selectedSession) {
    return (
       <div className="h-full flex flex-col">
         <div className="flex justify-between items-center mb-4">
            <button onClick={() => setSelectedSession(null)} className="text-sm font-bold text-slate-500 hover:text-blue-600 flex items-center gap-2 bg-white px-4 py-2 rounded-lg border shadow-sm transition-all"><ArrowLeft className="w-4 h-4"/> フォルダに戻る</button>
            
            <div className="flex gap-3">
                {(selectedSession.status === 'aborted' || selectedSession.status === 'paused' || selectedSession.status === 'processing') && (
                  <button onClick={() => onResume(selectedSession)} className="bg-amber-500 text-white px-5 py-2 rounded-lg shadow-md hover:bg-amber-600 text-sm font-bold flex items-center gap-2 animate-pulse transition-transform active:scale-95">
                    <PlayCircle className="w-4 h-4"/> 続きから再開 ({selectedSession.lastPage}ページ目〜)
                  </button>
                )}
                {selectedSession.status === 'processing' && (
                  <button onClick={() => onForceStop(selectedSession.id)} className="bg-slate-100 text-slate-600 px-5 py-2 rounded-lg hover:bg-red-50 hover:text-red-600 text-sm font-bold flex items-center gap-2 transition-colors">
                    <StopCircle className="w-4 h-4"/> 強制終了
                  </button>
                )}
            </div>
         </div>
         <ResultTableWithTabs 
           title={`${selectedSession.target} の履歴`}
           items={selectedSession.details?.map(item => ({...item, sessionUser: selectedSession.user, sessionDate: selectedSession.createdAt, source: selectedSession.target})) || []}
           onBack={null}
           currentUser={{name: selectedSession.user}}
         />
       </div>
    );
  }

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-500">
      <h2 className="text-2xl font-bold text-slate-800 mb-6 flex items-center gap-3"><FolderOpen className="w-8 h-8 text-blue-600"/> 検査履歴フォルダ</h2>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex-1 overflow-y-auto p-6">
        {Object.keys(groupedSessions).length === 0 && <div className="text-center text-slate-400 mt-20 font-medium">履歴フォルダは空です</div>}
        
        {Object.keys(groupedSessions).sort((a,b) => b.localeCompare(a)).map(month => (
          <div key={month} className="mb-4">
            <div onClick={() => toggleMonth(month)} className="flex items-center gap-3 cursor-pointer p-3 hover:bg-slate-50 rounded-xl select-none text-slate-700 font-bold text-lg transition-colors">
              {expandedMonths[month] ? <ChevronDown className="w-5 h-5 text-blue-500"/> : <ChevronRight className="w-5 h-5 text-slate-400"/>}
              <Folder className="w-5 h-5 text-blue-500 fill-blue-50"/> {month}
            </div>
            
            {expandedMonths[month] && (
              <div className="ml-5 border-l-2 border-slate-100 pl-4 mt-2 space-y-4">
                {Object.keys(groupedSessions[month]).sort((a,b) => parseInt(b)-parseInt(a)).map(day => (
                  <div key={day}>
                    <div onClick={() => toggleDay(month+day)} className="flex items-center gap-2 cursor-pointer p-2 hover:bg-slate-50 rounded-lg select-none text-sm font-bold text-slate-600 transition-colors">
                      {expandedDays[month+day] ? <ChevronDown className="w-4 h-4 text-slate-400"/> : <ChevronRight className="w-4 h-4 text-slate-300"/>}
                      <span>{day}</span>
                    </div>

                    {expandedDays[month+day] && (
                      <div className="ml-6 space-y-2 mt-2">
                        {groupedSessions[month][day].map(session => (
                           <div key={session.id} onClick={() => setSelectedSession(session)} className="flex items-center justify-between p-4 bg-white border border-slate-100 rounded-xl cursor-pointer group hover:border-blue-200 hover:shadow-md transition-all">
                             <div className="flex items-center gap-4 overflow-hidden">
                                <div className={`p-2.5 rounded-xl ${session.type==='url'?'bg-blue-50 text-blue-600':'bg-emerald-50 text-emerald-600'}`}>
                                   {session.type==='url' ? <ShoppingBag className="w-5 h-5"/> : <FileText className="w-5 h-5"/>}
                                </div>
                                <div className="min-w-0">
                                   <div className="flex items-center gap-3 mb-1">
                                     <p className="text-sm font-bold text-slate-700 truncate w-64 md:w-80">{session.target}</p>
                                     <SessionStatusBadge status={session.status} />
                                   </div>
                                   <p className="text-xs text-slate-400 flex items-center gap-3">
                                     <span className="flex items-center gap-1"><User className="w-3 h-3"/> {session.user}</span>
                                     <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/> {new Date(session.createdAt.seconds*1000).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span>
                                     {session.shopName && <span className="bg-slate-50 px-1.5 py-0.5 rounded text-[10px] border border-slate-100">{session.shopName}</span>}
                                   </p>
                                </div>
                             </div>
                             <div className="flex gap-3 items-center">
                               {session.summary?.critical > 0 && <span className="px-2.5 py-1 bg-purple-50 text-purple-700 text-xs font-bold rounded-lg flex items-center gap-1.5 border border-purple-100"><Siren className="w-3 h-3"/> {session.summary.critical}</span>}
                               <span className="px-3 py-1 bg-slate-50 text-slate-500 text-xs font-medium rounded-lg border border-slate-100">全{session.summary?.total}件</span>
                               
                               {currentUser?.role === 'admin' && (
                                <button 
                                    onClick={(e) => { e.stopPropagation(); onDelete(session.id); }}
                                    className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                                    title="削除"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                               )}
                             </div>
                           </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

const saveSessionToFirestore = async (db, currentUser, type, target, allResults) => {
    if (!db) return;
    try {
        const summary = {
            total: allResults.length,
            high: allResults.filter(r => r.risk === '高' || r.risk === 'High').length,
            medium: allResults.filter(r => r.risk === '中' || r.risk === 'Medium').length,
            critical: allResults.filter(r => r.isCritical).length
        };

        await addDoc(collection(db, 'check_sessions'), {
            type, 
            target, 
            user: currentUser.name,
            createdAt: serverTimestamp(),
            summary,
            details: allResults 
        });
    } catch (e) {
        console.error("Session Save Error", e);
    }
};

const UrlSearchView = ({ config, db, currentUser, addToast, state, setState, stopRef, isHighSpeed, setIsHighSpeed, historySessions, onResume }) => {
  const { targetUrl, results, isProcessing, progress, status, maxPages } = state;
  const [urlStep, setUrlStep] = useState('input'); 
  const [shopMeta, setShopMeta] = useState({ count: 0, shopCode: '', shopName: '' });
  const [checkRange, setCheckRange] = useState(30);
  const [sessionId, setSessionId] = useState(null); 
  const [liveLog, setLiveLog] = useState([]); 

  const previousHistory = useMemo(() => {
    if (!targetUrl) return null;
    const sameUrl = historySessions.find(s => s.target === targetUrl && s.type === 'url');
    return sameUrl;
  }, [targetUrl, historySessions]);

  const updateState = (updates) => setState(prev => ({ ...prev, ...updates }));

  const addLog = (msg) => setLiveLog(prev => [msg, ...prev].slice(0, 5));

  const fetchShopInfo = async () => {
    if (!config.rakutenAppId) return addToast('楽天アプリIDが設定されていません', 'error');
    if (!targetUrl) return addToast('URLを入力してください', 'error');
    
    if (window.location.hostname.includes('stackblitz') || window.location.hostname.includes('webcontainer')) {
      alert("【注意】StackBlitzプレビューでは動作しません。Vercel環境で実行してください。");
      return;
    }

    updateState({ isProcessing: true, status: 'ショップ情報取得中...' });
    try {
      const apiUrl = new URL('/api/rakuten', window.location.origin);
      apiUrl.searchParams.append('shopUrl', targetUrl);
      apiUrl.searchParams.append('appId', config.rakutenAppId);
      apiUrl.searchParams.append('page', '1'); 

      const res = await fetch(apiUrl.toString());
      if (!res.ok) throw new Error(`取得エラー: ${res.status}`);
      const data = await res.json();
      
      if (!data.count && (!data.products || data.products.length === 0)) {
        throw new Error("商品が見つかりませんでした");
      }

      const sName = data.products?.[0]?.shopName || '';
      setShopMeta({ count: data.count || 0, shopCode: data.shopCode, shopName: sName });
      
      setUrlStep('confirm');
      updateState({ status: '' });

    } catch (e) {
      addToast(e.message, 'error');
      updateState({ status: 'エラー' });
    } finally {
      updateState({ isProcessing: false });
    }
  };

  const updateSessionStatus = async (sessId, status, lastPage, details) => {
      if (!db || !sessId) return;
      try {
          const summary = {
              total: details.length,
              high: details.filter(r => r.risk === '高' || r.risk === 'High').length,
              medium: details.filter(r => r.risk === '中' || r.risk === 'Medium').length,
              critical: details.filter(r => r.isCritical).length
          };
          await updateDoc(doc(db, 'check_sessions', sessId), {
              status,
              lastPage,
              summary,
              details: details,
              updatedAt: serverTimestamp()
          });
      } catch(e) { console.error("Update Error", e); }
  };

  const runUrlCheckLoop = async (startP, sessId, currentResults, range) => {
      let page = startP;
      let totalResults = [...currentResults];
      // バグ修正: rangeが未定義の場合のフォールバック
      const targetRange = range || 30;
      const neededPages = Math.ceil(targetRange / 30); 

      try {
          while (page <= neededPages) {
              if (stopRef.current) {
                  await updateSessionStatus(sessId, 'paused', page - 1, totalResults);
                  updateState({ status: '中断しました' });
                  break;
              }

              addLog(`ページ ${page}/${neededPages} の商品データを取得中...`);
              updateState({ status: `データ取得中... (${page}ページ目)` });

              const apiUrl = new URL('/api/rakuten', window.location.origin);
              apiUrl.searchParams.append('shopUrl', targetUrl);
              apiUrl.searchParams.append('appId', config.rakutenAppId);
              apiUrl.searchParams.append('page', page.toString());

              const res = await fetch(apiUrl.toString());
              if (!res.ok) break;
              const data = await res.json();
              
              if (!data.products || data.products.length === 0) break;
              
              updateState({ status: `AI分析中... (${page}ページ目)` });
              const pageProducts = data.products.map(p => ({ productName: p.name, sourceFile: targetUrl, imageUrl: p.imageUrl, itemUrl: p.url }));
              
              const BATCH_SIZE = isHighSpeed ? 15 : 3;
              const WAIT_TIME = isHighSpeed ? 0 : 500;
              let pageResults = [];

              for (let i = 0; i < pageProducts.length; i += BATCH_SIZE) {
                  if (stopRef.current) break;
                  const batch = pageProducts.slice(i, i + BATCH_SIZE);
                  addLog(`AI分析中: ${batch[0].productName.slice(0, 15)}... 他${batch.length-1}件`);
                  
                  const promises = batch.map(item => analyzeItemRisk(item, config.apiKey).then(res => ({ ...item, ...res })));
                  const batchRes = await Promise.all(promises);
                  pageResults = [...pageResults, ...batchRes.map(r => ({...r, risk: r.risk_level, isCritical: r.is_critical}))];
                  
                  updateState({ 
                      results: [...totalResults, ...pageResults],
                      progress: ((totalResults.length + pageResults.length) / targetRange) * 100
                  });
                  
                  await new Promise(r => setTimeout(r, WAIT_TIME));
              }

              totalResults = [...totalResults, ...pageResults];
              await updateSessionStatus(sessId, 'processing', page, totalResults);
              if (totalResults.length >= targetRange) break;
              
              await new Promise(r => setTimeout(r, 1000));
              page++;
          }

          if (!stopRef.current) {
              await updateSessionStatus(sessId, 'completed', page - 1, totalResults);
              addToast('全チェック完了', 'success');
              setUrlStep('result');
          }

      } catch (e) {
          addToast(e.message, 'error');
          await updateSessionStatus(sessId, 'aborted', page - 1, totalResults);
      } finally {
          updateState({ isProcessing: false });
      }
  };

  const handleStart = async (resumeSession = null, overrideRange = null) => {
      if (!config.apiKey) return addToast('Gemini APIキーが設定されていません', 'error');
      
      // バグ修正: ボタンから渡された数値を優先的に使用する
      const activeRange = overrideRange || checkRange;

      setUrlStep('processing');
      setLiveLog([]);
      updateState({ isProcessing: true, status: '準備中...', progress: 0 });
      stopRef.current = false;

      let currentSessionId = null;
      let initialResults = [];
      let pageStart = 1;

      if (resumeSession) {
          currentSessionId = resumeSession.id;
          initialResults = resumeSession.details || [];
          pageStart = (resumeSession.lastPage || 0) + 1;
          setCheckRange(3000); 
          addToast(`${pageStart}ページ目から再開します`, 'info');
          await runUrlCheckLoop(pageStart, currentSessionId, initialResults, 3000);
      } else {
          if (db) {
              const docRef = await addDoc(collection(db, 'check_sessions'), {
                  type: 'url',
                  target: targetUrl,
                  shopName: shopMeta.shopName,
                  user: currentUser.name,
                  createdAt: serverTimestamp(),
                  status: 'processing',
                  lastPage: 0,
                  summary: { total: 0, high: 0, critical: 0 },
                  details: []
              });
              currentSessionId = docRef.id;
          }
          initialResults = [];
          pageStart = 1;
          // 修正: activeRangeを確実に渡す
          await runUrlCheckLoop(pageStart, currentSessionId, initialResults, activeRange);
      }
  };

  const handleReset = () => {
      setUrlStep('input');
      updateState({ results: [], progress: 0, status: '' });
      setShopMeta({ count: 0, shopCode: '', shopName: '' });
  };

  // --- Render Logic ---

  if (urlStep === 'input') {
    return (
      <div className="space-y-6 animate-in fade-in w-full">
        <div className="bg-white p-10 rounded-3xl border border-slate-100 shadow-xl shadow-slate-100 max-w-4xl mx-auto text-center">
            <div className="mb-8">
                <div className="inline-flex p-6 bg-blue-50 rounded-full mb-6 text-blue-600 shadow-inner"><ShoppingBag className="w-16 h-16"/></div>
                <h2 className="text-3xl font-bold text-slate-800 tracking-tight">楽天ショップ自動パトロール</h2>
                <p className="text-slate-500 mt-3 text-lg">ショップURLを入力すると、商品数を確認してからチェックを実行できます。</p>
            </div>
            <div className="flex flex-col md:flex-row gap-4 items-center justify-center max-w-2xl mx-auto">
                <input 
                    type="text" 
                    value={targetUrl} 
                    onChange={e => updateState({ targetUrl: e.target.value })} 
                    className="w-full px-6 py-4 border border-slate-200 rounded-2xl text-lg focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none shadow-sm transition-all" 
                    placeholder="https://www.rakuten.co.jp/shop-name/" 
                />
                <button onClick={fetchShopInfo} disabled={isProcessing} className="w-full md:w-auto px-10 py-4 bg-slate-900 text-white font-bold text-lg rounded-2xl hover:bg-slate-800 shadow-lg hover:shadow-xl transition-all flex items-center justify-center gap-3 active:scale-95">
                   {isProcessing ? <Loader2 className="w-6 h-6 animate-spin"/> : <Search className="w-6 h-6"/>} 確認
                </button>
            </div>
            {previousHistory && (
                 <div className="mt-8 bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center justify-center gap-3 text-amber-800">
                    <Info className="w-5 h-5"/>
                    <span className="font-medium">過去の履歴あり: {new Date(previousHistory.createdAt.seconds*1000).toLocaleDateString()} ({previousHistory.summary?.total}件)</span>
                    {previousHistory.status !== 'completed' && (
                         <button onClick={() => handleStart(previousHistory)} className="ml-2 bg-white px-4 py-1.5 rounded-lg text-sm font-bold shadow-sm hover:shadow hover:text-amber-900 transition-all">続きから再開</button>
                    )}
                 </div>
            )}
            {!config.rakutenAppId && <p className="text-red-500 font-bold mt-6 bg-red-50 inline-block px-6 py-2 rounded-full">⚠ 設定画面で楽天アプリIDを入力してください</p>}
        </div>
      </div>
    );
  }

  if (urlStep === 'confirm') {
      return (
          <div className="space-y-6 animate-in fade-in w-full">
              <div className="bg-white p-10 rounded-3xl border border-slate-100 shadow-xl shadow-slate-100 max-w-4xl mx-auto">
                  <button onClick={handleReset} className="mb-6 text-sm font-bold text-slate-400 hover:text-blue-600 flex items-center gap-2 transition-colors"><ArrowLeft className="w-5 h-5"/> 戻る</button>
                  
                  <h2 className="text-2xl font-bold text-slate-800 mb-8 flex items-center gap-3"><ShoppingBag className="w-8 h-8 text-blue-600"/> 取得対象の確認</h2>
                  
                  <div className="bg-slate-50 p-8 rounded-2xl mb-10 flex flex-col md:flex-row items-center justify-between border border-slate-100 gap-6">
                      <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">TARGET SHOP</p>
                          <p className="text-2xl font-bold text-slate-800 truncate">{shopMeta.shopName || '取得中...'}</p>
                          <p className="text-sm text-slate-500 font-mono truncate opacity-70 mt-1">{targetUrl}</p>
                      </div>
                      <div className="text-right bg-white px-8 py-4 rounded-xl shadow-sm border border-slate-100">
                          <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">TOTAL ITEMS</p>
                          <p className="text-4xl font-bold text-blue-600 tracking-tight">{shopMeta.count.toLocaleString()} <span className="text-sm text-slate-400 font-normal">件</span></p>
                      </div>
                  </div>

                  <div className="space-y-6">
                      <p className="font-bold text-slate-700 text-lg">チェック範囲を選択してください:</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          <button onClick={() => { setCheckRange(30); handleStart(null, 30); }} className="group p-6 border-2 border-slate-100 hover:border-blue-500 bg-white hover:bg-blue-50/30 rounded-2xl text-left transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                              <div className="font-bold text-xl text-slate-800 mb-2 group-hover:text-blue-700">クイック</div>
                              <div className="text-blue-600 font-bold text-3xl mb-1">30 <span className="text-sm font-normal text-slate-500">件</span></div>
                              <div className="text-xs font-bold text-slate-400 bg-slate-100 inline-block px-2 py-1 rounded">所要時間: 約30秒</div>
                          </button>
                          <button onClick={() => { setCheckRange(300); handleStart(null, 300); }} className="group p-6 border-2 border-slate-100 hover:border-blue-500 bg-white hover:bg-blue-50/30 rounded-2xl text-left transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
                              <div className="font-bold text-xl text-slate-800 mb-2 group-hover:text-blue-700">スタンダード</div>
                              <div className="text-blue-600 font-bold text-3xl mb-1">300 <span className="text-sm font-normal text-slate-500">件</span></div>
                              <div className="text-xs font-bold text-slate-400 bg-slate-100 inline-block px-2 py-1 rounded">所要時間: 約5分</div>
                          </button>
                          <button onClick={() => { setCheckRange(3000); handleStart(null, 3000); }} className="group p-6 border-2 border-slate-100 hover:border-blue-500 bg-white hover:bg-blue-50/30 rounded-2xl text-left transition-all duration-300 hover:shadow-lg hover:-translate-y-1 relative overflow-hidden">
                              {shopMeta.count > 3000 && <div className="absolute top-0 right-0 bg-red-500 text-white text-[10px] font-bold px-3 py-1 rounded-bl-xl">LIMIT APPLIED</div>}
                              <div className="font-bold text-xl text-slate-800 mb-2 group-hover:text-blue-700">フルスキャン</div>
                              <div className="text-blue-600 font-bold text-3xl mb-1">Max <span className="text-sm font-normal text-slate-500">3000件</span></div>
                              <div className="text-xs font-bold text-slate-400 bg-slate-100 inline-block px-2 py-1 rounded">所要時間: 30分〜</div>
                          </button>
                      </div>
                  </div>
              </div>
          </div>
      );
  }

  if (urlStep === 'processing') {
      const latestItem = results.length > 0 ? results[results.length - 1] : null;
      return (
          <div className="h-full flex flex-col animate-in fade-in space-y-6">
             {/* Status Header */}
             <div className="bg-slate-900 text-white p-8 rounded-3xl shadow-2xl flex flex-col md:flex-row gap-8 items-center relative overflow-hidden">
                 <div className="absolute top-0 right-0 w-64 h-64 bg-blue-500 rounded-full filter blur-3xl opacity-10 -translate-y-1/2 translate-x-1/3"></div>
                 
                 <div className="flex-1 w-full z-10">
                    <div className="flex items-center gap-4 mb-6">
                        <div className="relative">
                            <Activity className="w-10 h-10 text-emerald-400 animate-pulse"/>
                            <span className="absolute top-0 right-0 w-3 h-3 bg-emerald-400 rounded-full animate-ping"></span>
                        </div>
                        <div>
                            <h2 className="text-2xl font-bold tracking-tight">AIリアルタイム監査中</h2>
                            <p className="text-blue-200 text-sm font-mono mt-1">{status}</p>
                        </div>
                    </div>
                    <div className="w-full bg-slate-800/50 rounded-full h-4 overflow-hidden mb-3 border border-slate-700">
                        <div className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-500 ease-out shadow-[0_0_15px_rgba(59,130,246,0.5)]" style={{ width: `${progress}%` }}></div>
                    </div>
                    <div className="flex justify-between text-xs font-mono text-slate-400">
                        <span>Progress: {Math.round(progress)}%</span>
                        <span>Checked: {results.length} items</span>
                    </div>
                 </div>

                 {/* Live Preview Card */}
                 <div className="w-full md:w-80 bg-slate-800/80 backdrop-blur rounded-2xl p-5 border border-slate-700/50 flex items-center gap-5 shadow-xl z-10">
                    {latestItem ? (
                        <>
                            <div className="relative">
                                <img src={latestItem.imageUrl} alt="" className="w-20 h-20 object-cover rounded-xl bg-white shadow-sm" />
                                {(latestItem.risk === '高' || latestItem.isCritical) && <div className="absolute -top-2 -right-2 bg-red-500 w-4 h-4 rounded-full animate-ping"></div>}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-1">ANALYZING NOW</p>
                                <p className="text-sm font-bold truncate text-white mb-2">{latestItem.productName}</p>
                                <div>
                                    {(latestItem.risk === '高' || latestItem.isCritical) ? 
                                        <span className="text-red-400 font-bold text-xs flex items-center gap-1 bg-red-500/10 px-2 py-1 rounded"><Siren className="w-3 h-3"/> High Risk</span> : 
                                        <span className="text-emerald-400 font-bold text-xs flex items-center gap-1 bg-emerald-500/10 px-2 py-1 rounded"><CheckCircle className="w-3 h-3"/> Safe</span>
                                    }
                                </div>
                            </div>
                        </>
                    ) : <div className="text-slate-500 text-sm flex items-center justify-center w-full h-20 font-mono">Waiting for stream...</div>}
                 </div>
             </div>

             {/* Live Table (Growing List) */}
             <div className="flex-1 min-h-0 bg-white rounded-3xl border border-slate-200 shadow-xl overflow-hidden flex flex-col">
                 <div className="p-4 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                     <h3 className="font-bold text-slate-700 flex items-center gap-2"><Terminal className="w-4 h-4"/> 検出ログ</h3>
                     <button onClick={() => stopRef.current = true} className="text-xs font-bold text-red-500 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-colors border border-transparent hover:border-red-100">中断して結果を見る</button>
                 </div>
                 <div className="flex-1 overflow-hidden">
                     <ResultTableWithTabs items={results} currentUser={currentUser} title="" showDownload={false} />
                 </div>
             </div>
          </div>
      );
  }

  if (urlStep === 'result') {
      return <ResultTableWithTabs items={results} currentUser={currentUser} title="検索結果一覧" onBack={handleReset} />;
  }

  return null;
};

const CsvSearchView = ({ config, db, currentUser, addToast, state, setState, stopRef, isHighSpeed, setIsHighSpeed }) => {
  const { files, results, isProcessing, progress } = state;
  const updateState = (updates) => setState(prev => ({ ...prev, ...updates }));

  const [encoding, setEncoding] = useState('Shift_JIS');
  const [targetColIndex, setTargetColIndex] = useState(0);
  const [headers, setHeaders] = useState([]);

  const handleFileUpload = async (e) => {
    const uploadedFiles = e.target.files ? Array.from(e.target.files) : [];
    if (uploadedFiles.length === 0) return;
    updateState({ files: uploadedFiles, results: [] });
    
    try {
      const text = await readFileAsText(uploadedFiles[0], encoding);
      const parsed = parseCSV(text);
      if (parsed.length > 0) {
        setHeaders(parsed[0]);
        const nameIdx = parsed[0].findIndex(h => h.includes('商品名') || h.includes('Name'));
        if(nameIdx !== -1) setTargetColIndex(nameIdx);
      }
    } catch(e) {}
  };

  const startCheck = async () => {
    if (!config.apiKey) return addToast('APIキーが設定されていません', 'error');
    if (files.length === 0) return;

    updateState({ isProcessing: true });
    stopRef.current = false;
    let processed = 0;
    let totalItems = 0;
    let allData = [];

    for (let file of files) {
      try {
        const text = await readFileAsText(file, encoding);
        const parsed = parseCSV(text);
        if (parsed.length > 1) {
          const rows = parsed.slice(1).map(row => ({ 
            productName: row[targetColIndex], 
            imageUrl: null, 
            sourceFile: file.name 
          }));
          allData = [...allData, ...rows];
        }
      } catch (e) { addToast(`${file.name} 読込失敗`, 'error'); }
    }
    totalItems = allData.length;

    const BATCH = isHighSpeed ? 15 : 3;
    const WAIT_TIME = isHighSpeed ? 0 : 500;
    let finalResults = [];

    for(let i=0; i<allData.length; i+=BATCH) {
      if(stopRef.current) break;
      const batch = allData.slice(i, i+BATCH);
      const promises = batch.map(item => 
        item.productName ? analyzeItemRisk(item, config.apiKey).then(res => ({...item, ...res})) 
                         : Promise.resolve({...item, risk_level: '低', reason: '-'})
      );
      
      const resBatch = await Promise.all(promises);
      finalResults = [...finalResults, ...resBatch.map(r => ({...r, risk: r.risk_level, isCritical: r.is_critical}))];
      
      setState(prev => ({
        ...prev,
        results: [...prev.results, ...resBatch.map(r => ({...r, risk: r.risk_level, isCritical: r.is_critical}))],
        progress: ((processed + batch.length) / totalItems) * 100
      }));
      
      processed += batch.length;
      if (WAIT_TIME > 0) await new Promise(r => setTimeout(r, WAIT_TIME));
    }

    if (db && finalResults.length > 0) {
        await saveSessionToFirestore(db, currentUser, 'csv', files.map(f=>f.name).join(','), finalResults);
    }

    updateState({ isProcessing: false });
    addToast('CSVチェック完了', 'success');
  };

  if (!isProcessing && results.length > 0) {
      return <ResultTableWithTabs 
          items={results} 
          currentUser={currentUser} 
          title="CSV検査結果" 
          onBack={() => updateState({ results: [], files: [] })} 
      />;
  }

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4 w-full">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 transition-colors cursor-pointer relative">
            <input type="file" multiple accept=".csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileUpload} disabled={isProcessing} />
            <FolderOpen className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-slate-700">CSVファイルをドラッグ＆ドロップ</h3>
            <p className="text-slate-400">またはクリックして選択 (Shift-JIS対応)</p>
            {files.length > 0 && <div className="mt-2 font-bold text-blue-600">{files.length}ファイル選択中</div>}
          </div>
          <div className="w-64 space-y-2">
            <div onClick={() => setIsHighSpeed(!isHighSpeed)} className={`p-3 rounded-lg cursor-pointer border flex items-center justify-between ${isHighSpeed ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-slate-50 text-slate-500'}`}>
               <div className="flex items-center gap-2">
                 <Zap className={`w-4 h-4 ${isHighSpeed ? 'fill-indigo-500 text-indigo-500' : 'text-slate-400'}`} />
                 <span className="text-xs font-bold">高速モード</span>
               </div>
               <span className="text-xs font-mono">{isHighSpeed ? 'ON' : 'OFF'}</span>
            </div>
            <select value={encoding} onChange={e => setEncoding(e.target.value)} className="w-full p-2 border rounded bg-white"><option value="Shift_JIS">Shift_JIS (楽天)</option><option value="UTF-8">UTF-8 (一般)</option></select>
            <select value={targetColIndex} onChange={e => setTargetColIndex(Number(e.target.value))} className="w-full p-2 border rounded bg-white" disabled={headers.length === 0}>
              {headers.length === 0 && <option>カラム未選択</option>}
              {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
            </select>
          </div>
        </div>
        {isProcessing && <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 transition-all duration-300" style={{width: `${progress}%`}}></div></div>}
        {!isProcessing ? (
          <button onClick={startCheck} disabled={files.length === 0} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-sm">CSVチェック開始</button>
        ) : (
          <button onClick={() => {stopRef.current = true;}} className="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-sm">停止</button>
        )}
      </div>
    </div>
  );
};

const UserManagementView = ({ db, userList, addToast }) => {
  const [newUser, setNewUser] = useState({ name: '', loginId: '', password: '', role: 'staff' });
  
  const handleAdd = async () => {
    if (!newUser.name || !newUser.loginId || !newUser.password) return addToast('全項目入力してください', 'error');
    try {
      await addDoc(collection(db, 'app_users'), { ...newUser, createdAt: serverTimestamp() });
      setNewUser({ name: '', loginId: '', password: '', role: 'staff' });
      addToast('ユーザーを追加しました', 'success');
    } catch (e) { addToast('追加失敗', 'error'); }
  };

  return (
    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm animate-in fade-in w-full">
      <h2 className="font-bold text-lg mb-6 flex items-center gap-2"><Users className="w-5 h-5 text-blue-600"/> ユーザー管理</h2>
      <div className="flex flex-col md:flex-row gap-4 items-end mb-8 bg-slate-50 p-4 rounded-lg">
        <div className="flex-1 w-full"><label className="text-xs font-bold text-slate-500">名前</label><input className="w-full p-2 border rounded" value={newUser.name} onChange={e=>setNewUser({...newUser, name: e.target.value})} /></div>
        <div className="flex-1 w-full"><label className="text-xs font-bold text-slate-500">ID</label><input className="w-full p-2 border rounded" value={newUser.loginId} onChange={e=>setNewUser({...newUser, loginId: e.target.value})} /></div>
        <div className="flex-1 w-full"><label className="text-xs font-bold text-slate-500">PASS</label><input className="w-full p-2 border rounded" value={newUser.password} onChange={e=>setNewUser({...newUser, password: e.target.value})} /></div>
        <div className="w-full md:w-24"><label className="text-xs font-bold text-slate-500">権限</label><select className="w-full p-2 border rounded" value={newUser.role} onChange={e=>setNewUser({...newUser, role: e.target.value})}><option value="staff">Staff</option><option value="admin">Admin</option></select></div>
        <button onClick={handleAdd} className="w-full md:w-auto px-4 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 flex items-center justify-center gap-1"><UserPlus className="w-4 h-4"/> 追加</button>
      </div>
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 font-bold text-slate-600"><tr><th className="p-3">名前</th><th className="p-3">ID</th><th className="p-3">権限</th><th className="p-3 text-right">操作</th></tr></thead>
        <tbody className="divide-y">{userList.map(u => <tr key={u.id}><td className="p-3">{u.name}</td><td className="p-3 font-mono">{u.loginId}</td><td className="p-3"><span className="bg-slate-100 px-2 py-1 rounded text-xs">{u.role}</span></td><td className="p-3 text-right"><button onClick={() => deleteDoc(doc(db, 'app_users', u.id))} className="text-red-500 hover:bg-red-50 p-1 rounded"><Trash2 className="w-4 h-4"/></button></td></tr>)}</tbody>
      </table>
    </div>
  );
};

const SettingsView = ({ config, setConfig, addToast, initFirebase }) => {
  const handleSave = () => {
    localStorage.setItem('gemini_api_key', config.apiKey);
    localStorage.setItem('rakuten_app_id', config.rakutenAppId);
    localStorage.setItem('firebase_config', config.firebaseJson);
    initFirebase(config.firebaseJson);
    addToast('設定を保存しました', 'success');
  };

  return (
    <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl border border-slate-200 shadow-sm animate-in fade-in w-full">
      <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Settings className="w-6 h-6 text-slate-700"/> システム設定</h2>
      <div className="space-y-6">
        <div><label className="block font-bold text-sm mb-1">Gemini API Key</label><input type="password" value={config.apiKey} onChange={e => setConfig({...config, apiKey: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
        <div><label className="block font-bold text-sm mb-1">楽天 Application ID</label><input type="text" value={config.rakutenAppId} onChange={e => setConfig({...config, rakutenAppId: e.target.value})} className="w-full p-3 border rounded-lg" /></div>
        <div><label className="block font-bold text-sm mb-1">Firebase Config</label><textarea value={config.firebaseJson} onChange={e => setConfig({...config, firebaseJson: e.target.value})} className="w-full p-3 border rounded-lg h-32 font-mono text-xs" placeholder="Paste config here..." /></div>
        <button onClick={handleSave} className="w-full py-3 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900 flex items-center justify-center gap-2"><Cloud className="w-4 h-4"/> 設定を保存（チーム全体）</button>
        <p className="text-xs text-slate-400 text-center">※保存するとチーム全員の設定が更新されます（機能準備中）</p>
      </div>
    </div>
  );
};

// App Container
export default function App() {
  const [currentUser, setCurrentUser] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [activeTab, setActiveTab] = useState('dashboard');
  
  const [config, setConfig] = useState({ apiKey: '', rakutenAppId: '', firebaseJson: '' });
  const [db, setDb] = useState(null);
  const [dbStatus, setDbStatus] = useState('未接続');

  const [historySessions, setHistorySessions] = useState([]);
  const [userList, setUserList] = useState([]);

  // Lifted States
  const [urlSearchState, setUrlSearchState] = useState({ targetUrl: '', results: [], isProcessing: false, progress: 0, status: '', maxPages: 5 });
  const urlSearchStopRef = useRef(false);

  const [csvSearchState, setCsvSearchState] = useState({ files: [], results: [], isProcessing: false, progress: 0 });
  const csvSearchStopRef = useRef(false);

  const [isHighSpeed, setIsHighSpeed] = useState(false); 
  
  // NEW: Inspect session from Dashboard
  const [inspectSession, setInspectSession] = useState(null);

  const addToast = (message, type = 'info') => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  };

  const initFirebase = (configStr) => {
    if (!configStr) return;
    const fbConfig = parseFirebaseConfig(configStr);
    if (!fbConfig) {
      setDbStatus('設定エラー');
      return;
    }
    try {
      let app = getApps().length > 0 ? getApp() : initializeApp(fbConfig);
      const firestore = getFirestore(app);
      setDb(firestore);
      setDbStatus('接続OK');
      
      const q = query(collection(firestore, 'check_sessions'), orderBy('createdAt', 'desc'), limit(500));
      onSnapshot(q, (snap) => setHistorySessions(snap.docs.map(d => ({ id: d.id, ...d.data() }))), 
        err => console.warn("History sync warning:", err));

      onSnapshot(collection(firestore, 'app_users'), (snap) => setUserList(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
        err => {}); 
        
    } catch (e) {
      console.error(e);
      setDbStatus('接続エラー');
    }
  };

  useEffect(() => {
    const savedApiKey = localStorage.getItem('gemini_api_key') || '';
    const savedRakutenId = localStorage.getItem('rakuten_app_id') || '';
    const savedFbConfig = localStorage.getItem('firebase_config') || '';
    const savedSession = localStorage.getItem('app_session'); 

    if (savedApiKey) setApiKey(savedApiKey);
    if (savedRakutenId) setRakutenAppId(savedRakutenId);
    if (savedFbConfig) {
      setFirebaseConfigJson(savedFbConfig);
      initFirebase(savedFbConfig);
    }
    if (savedSession) {
       try {
          setCurrentUser(JSON.parse(savedSession));
       } catch(e){}
    }
  }, []);

  const handleLogin = async (id, pass) => {
    if (id === 'admin' && pass === APP_CONFIG.FIXED_PASSWORD) {
      const adminUser = { name: '管理者(System)', role: 'admin' };
      setCurrentUser(adminUser);
      localStorage.setItem('app_session', JSON.stringify(adminUser));
      addToast('管理者としてログインしました', 'success');
      return;
    }
    if (!db) return addToast('Firebase未接続のため初期管理者のみログイン可能です', 'error');

    try {
      const q = query(collection(db, 'app_users'), where('loginId', '==', id), where('password', '==', pass));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const userData = snap.docs[0].data();
        const userObj = { name: userData.name, role: userData.role };
        setCurrentUser(userObj);
        localStorage.setItem('app_session', JSON.stringify(userObj));
        addToast(`ようこそ、${userData.name}さん`, 'success');
      } else {
        addToast('IDまたはパスワードが違います', 'error');
      }
    } catch (e) {
      addToast('ログイン処理中にエラーが発生しました', 'error');
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem('app_session');
    setActiveTab('dashboard');
    addToast('ログアウトしました', 'info');
  };

  const handleResumeSession = (session) => {
     setUrlSearchState(prev => ({ ...prev, resumeSession: session }));
     setActiveTab('url');
  };

  const handleForceStop = async (sessionId) => {
    if(!confirm("この検査を強制的に「中断」扱いにしますか？\n(ブラウザを閉じてしまった場合などに使用します)")) return;
    if(db) {
      await updateDoc(doc(db, 'check_sessions', sessionId), {
        status: 'aborted',
        updatedAt: serverTimestamp()
      });
    }
  };

  const handleDeleteSession = async (sessionId) => {
    if (!db) return;
    if (!confirm("この検査履歴を完全に削除しますか？\n復元はできません。")) return;
    
    try {
      await deleteDoc(doc(db, 'check_sessions', sessionId));
      addToast('履歴を削除しました', 'success');
    } catch (e) {
      console.error(e);
      addToast('削除に失敗しました', 'error');
    }
  };

  // Handle inspecting a session from Dashboard
  const handleInspectSession = (session) => {
    setInspectSession(session);
    setActiveTab('history');
  };

  if (!currentUser) return <LoginView onLogin={handleLogin} />;

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col">
      <ToastContainer toasts={toasts} removeToast={(id) => setToasts(prev => prev.filter(t => t.id !== id))} />
      
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30 shadow-sm h-16 flex items-center justify-between px-6">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-1.5 rounded-lg"><ShieldAlert className="w-5 h-5 text-white" /></div>
          <h1 className="font-bold text-lg text-slate-800 tracking-tight">Rakuten Patrol <span className="text-xs font-normal text-slate-400 ml-1">Pro</span></h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full">
            <User className="w-4 h-4 text-slate-500" />
            <span className="text-xs font-bold text-slate-700">{currentUser.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-white rounded border border-slate-200 text-slate-500">{currentUser.role === 'admin' ? 'ADMIN' : 'STAFF'}</span>
          </div>
          <button onClick={handleLogout} className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-full transition-colors"><LogOut className="w-5 h-5" /></button>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="w-64 bg-white border-r border-slate-200 flex flex-col overflow-y-auto hidden md:flex">
          <div className="p-4 space-y-1">
            <NavButton icon={LayoutDashboard} label="ダッシュボード" id="dashboard" active={activeTab} onClick={setActiveTab} />
            <div className="my-2 border-b border-slate-100" />
            <NavButton icon={ShoppingBag} label="楽天URL検索" id="url" active={activeTab} onClick={setActiveTab} />
            <NavButton icon={FileText} label="CSV一括検査" id="checker" active={activeTab} onClick={setActiveTab} />
            <div className="my-2 border-b border-slate-100" />
            <NavButton icon={History} label="検査履歴" id="history" active={activeTab} onClick={setActiveTab} />
            {currentUser.role === 'admin' && (
              <>
                <div className="my-2 border-b border-slate-100" />
                <NavButton icon={Users} label="ユーザー管理" id="users" active={activeTab} onClick={setActiveTab} />
                <NavButton icon={Settings} label="システム設定" id="settings" active={activeTab} onClick={setActiveTab} />
              </>
            )}
          </div>
          <div className="mt-auto p-4 border-t border-slate-100">
            <div className="text-xs text-slate-400 flex justify-between items-center">
              <span>Status</span>
              <span className={`flex items-center gap-1 ${dbStatus === '接続OK' ? 'text-green-500' : 'text-red-500'}`}>
                <span className={`w-2 h-2 rounded-full ${dbStatus === '接続OK' ? 'bg-green-500' : 'bg-red-500'}`} />
                {dbStatus}
              </span>
            </div>
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto p-6 w-full">
          {activeTab === 'dashboard' && <DashboardView sessions={historySessions} onNavigate={setActiveTab} onResume={handleResumeSession} onForceStop={handleForceStop} onInspectSession={handleInspectSession} />}
          
          {/* URL Search View */}
          <div className={activeTab === 'url' ? 'block' : 'hidden'}>
             <UrlSearchView config={config} db={db} currentUser={currentUser} addToast={addToast} state={urlSearchState} setState={setUrlSearchState} stopRef={urlSearchStopRef} isHighSpeed={isHighSpeed} setIsHighSpeed={setIsHighSpeed} historySessions={historySessions} onResume={handleResumeSession} />
          </div>

          {/* CSV Search View */}
          <div className={activeTab === 'checker' ? 'block' : 'hidden'}>
             <CsvSearchView config={config} db={db} currentUser={currentUser} addToast={addToast} state={csvSearchState} setState={setCsvSearchState} stopRef={csvSearchStopRef} isHighSpeed={isHighSpeed} setIsHighSpeed={setIsHighSpeed} />
          </div>

          {activeTab === 'history' && <HistoryView sessions={historySessions} onResume={(session) => { setActiveTab('url'); setUrlSearchState(p => ({...p, resumeSession: session})); }} onForceStop={handleForceStop} onDelete={handleDeleteSession} currentUser={currentUser} inspectSession={inspectSession} />}
          {activeTab === 'users' && <UserManagementView db={db} userList={userList} addToast={addToast} />}
          {activeTab === 'settings' && <SettingsView config={config} setConfig={setConfig} addToast={addToast} initFirebase={initFirebase} />}
        </main>
      </div>
    </div>
  );
}