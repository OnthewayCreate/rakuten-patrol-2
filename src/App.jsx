import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Upload, FileText, CheckCircle, Play, Download, Loader2, ShieldAlert, Pause, Trash2, Eye, Zap, FolderOpen, Lock, LogOut, History, Settings, Save, Search, Globe, ShoppingBag, AlertCircle, RefreshCw, ExternalLink, Siren, User, Users, UserPlus, X, LayoutDashboard, ChevronRight } from 'lucide-react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, where, getDocs, deleteDoc, doc } from 'firebase/firestore';

/**
 * ============================================================================
 * System Configuration & Utilities
 * ============================================================================
 */
const APP_CONFIG = {
  FIXED_PASSWORD: 'admin123',
  API_TIMEOUT: 15000,
  RETRY_LIMIT: 5,
  VERSION: '3.1.0-PRO'
};

// --- Utility: CSV Parser ---
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

// --- Utility: File Reader ---
const readFileAsText = (file, encoding) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target.result);
    reader.onerror = (e) => reject(e);
    reader.readAsText(file, encoding);
  });
};

// --- Utility: Robust Firebase Config Parser ---
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

    if (response.status === 429 || response.status === 504) {
      if (retryCount < APP_CONFIG.RETRY_LIMIT) {
        const waitTime = Math.pow(2, retryCount + 1) * 1000 + (Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return analyzeItemRisk(itemData, apiKey, retryCount + 1);
      } else {
        throw new Error("Server Busy (Rate Limit Exceeded)");
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
 * UI Components
 * ============================================================================
 */

const ToastContainer = ({ toasts, removeToast }) => (
  <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
    {toasts.map((toast) => (
      <div key={toast.id} className={`pointer-events-auto min-w-[300px] p-4 rounded-lg shadow-lg text-white flex justify-between items-center animate-in slide-in-from-right fade-in duration-300 ${toast.type === 'error' ? 'bg-red-600' : toast.type === 'success' ? 'bg-green-600' : 'bg-blue-600'}`}>
        <span className="text-sm font-medium">{toast.message}</span>
        <button onClick={() => removeToast(toast.id)}><X className="w-4 h-4 opacity-80 hover:opacity-100" /></button>
      </div>
    ))}
  </div>
);

const RiskBadge = ({ item }) => {
  const { risk, isCritical } = item;
  if (isCritical) return <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-purple-600 text-white items-center gap-1 shadow-sm animate-pulse"><Siren className="w-3 h-3"/> 重大な疑い</span>;
  if (risk === '高' || risk === 'High') return <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">高 (危険)</span>;
  if (risk === '中' || risk === 'Medium') return <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-yellow-100 text-yellow-700 border border-yellow-200">中 (要確認)</span>;
  return <span className="inline-flex px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">問題なし</span>;
};

const StatCard = ({ title, value, icon: Icon, color }) => (
  <div className="bg-white p-6 rounded-xl border border-slate-100 shadow-sm flex items-center gap-4">
    <div className={`p-3 rounded-full ${color} bg-opacity-10`}>
      <Icon className={`w-6 h-6 ${color.replace('bg-', 'text-')}`} />
    </div>
    <div>
      <p className="text-sm text-slate-500 font-medium">{title}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
    </div>
  </div>
);

const NavButton = ({ icon: Icon, label, id, active, onClick }) => (
  <button
    onClick={() => onClick(id)}
    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${active === id ? 'bg-blue-50 text-blue-700 shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
  >
    <Icon className={`w-4 h-4 ${active === id ? 'text-blue-600' : 'text-slate-400'}`} />
    {label}
    {active === id && <ChevronRight className="w-3 h-3 ml-auto text-blue-400" />}
  </button>
);

const LoginView = ({ onLogin }) => {
  const [id, setId] = useState('');
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await onLogin(id.trim(), pass.trim());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-2xl shadow-xl max-w-sm w-full border border-white/50 backdrop-blur-sm">
        <div className="text-center mb-8">
          <div className="inline-flex p-4 bg-blue-600 rounded-xl shadow-lg shadow-blue-200 mb-4">
            <ShieldAlert className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Rakuten Patrol</h1>
          <p className="text-sm text-slate-500 mt-1">知的財産権侵害対策システム</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Login ID</label>
            <div className="relative">
              <User className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
              <input type="text" value={id} onChange={e => setId(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" placeholder="IDを入力" required />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase mb-1.5">Password</label>
            <div className="relative">
              <Lock className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
              <input type="password" value={pass} onChange={e => setPass(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all" placeholder="パスワード" required />
            </div>
          </div>
          <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 active:scale-[0.98] transition-all shadow-md disabled:opacity-70 disabled:cursor-not-allowed flex justify-center items-center gap-2">
            {loading && <Loader2 className="w-4 h-4 animate-spin" />} ログイン
          </button>
        </form>
      </div>
    </div>
  );
};

const DashboardView = ({ historyData, onNavigate }) => {
  const stats = useMemo(() => {
    const total = historyData.length;
    const critical = historyData.filter(i => i.isCritical || i.is_critical).length;
    const high = historyData.filter(i => i.risk === '高' || i.risk === 'High').length;
    const today = historyData.filter(i => {
      if (!i.createdAt) return false;
      const d = new Date(i.createdAt.seconds * 1000);
      const now = new Date();
      return d.getDate() === now.getDate() && d.getMonth() === now.getMonth();
    }).length;
    return { total, critical, high, today };
  }, [historyData]);

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">ダッシュボード</h2>
          <p className="text-slate-500">最新のパトロール状況のサマリー</p>
        </div>
        <button onClick={() => onNavigate('url')} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-blue-700 shadow-sm flex items-center gap-2">
          <Search className="w-4 h-4" /> 新規チェック開始
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard title="本日のチェック数" value={stats.today} icon={RefreshCw} color="bg-blue-500 text-blue-500" />
        <StatCard title="重大な疑い" value={stats.critical} icon={Siren} color="bg-purple-500 text-purple-500" />
        <StatCard title="高リスク商品数" value={stats.high} icon={AlertCircle} color="bg-red-500 text-red-500" />
        <StatCard title="ログ保存総数" value={stats.total} icon={History} color="bg-slate-500 text-slate-500" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
          <h3 className="font-bold text-slate-700">直近の検知アラート</h3>
          <button onClick={() => onNavigate('history')} className="text-sm text-blue-600 hover:underline">すべて見る</button>
        </div>
        <div className="divide-y divide-slate-100">
          {historyData.slice(0, 5).map((item) => (
            <div key={item.id} className="p-4 hover:bg-slate-50 transition-colors flex items-start gap-4">
              <div className="mt-1"><RiskBadge item={item} /></div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{item.productName}</p>
                <p className="text-xs text-slate-500 mt-1 line-clamp-1">{item.reason}</p>
                <p className="text-[10px] text-slate-400 mt-1 flex gap-2">
                  <span>{item.pic || 'System'}</span>
                  <span>•</span>
                  <span>{item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleString() : '-'}</span>
                </p>
              </div>
            </div>
          ))}
          {historyData.length === 0 && <div className="p-8 text-center text-slate-400">データがありません</div>}
        </div>
      </div>
    </div>
  );
};

// --- Modified UrlSearchView to accept State Props ---
const UrlSearchView = ({ config, db, currentUser, addToast, state, setState, stopRef }) => {
  // Destructure from state prop instead of local useState
  const { targetUrl, results, isProcessing, progress, status, maxPages } = state;
  
  // Helper to update state
  const updateState = (updates) => setState(prev => ({ ...prev, ...updates }));

  const handleSearch = async () => {
    if (!config.rakutenAppId) return addToast('楽天アプリIDが設定されていません', 'error');
    if (!config.apiKey) return addToast('Gemini APIキーが設定されていません', 'error');
    if (!targetUrl) return addToast('URLを入力してください', 'error');

    updateState({ isProcessing: true, results: [], status: 'データ取得開始...', progress: 0 });
    stopRef.current = false;

    let allProducts = [];
    let page = 1;
    let totalPages = 1;

    try {
      while (page <= maxPages && page <= totalPages) {
        if (stopRef.current) break;
        updateState({ status: `データ取得中... (${page}ページ目完了 / 現在${allProducts.length}件)` });
        
        const apiUrl = new URL('/api/rakuten', window.location.origin);
        apiUrl.searchParams.append('shopUrl', targetUrl);
        apiUrl.searchParams.append('appId', config.rakutenAppId);
        apiUrl.searchParams.append('page', page.toString());

        const res = await fetch(apiUrl.toString());
        if (!res.ok) throw new Error(`楽天APIエラー: ${res.status}`);
        const data = await res.json();
        
        if (page === 1 && (!data.products || data.products.length === 0)) {
          throw new Error("商品が見つかりませんでした");
        }
        if (page === 1) totalPages = data.pageCount;

        const newProducts = data.products.map(p => ({
          productName: p.name,
          sourceFile: targetUrl,
          imageUrl: p.imageUrl,
          itemUrl: p.url
        }));
        allProducts = [...allProducts, ...newProducts];
        await new Promise(r => setTimeout(r, 1000));
        page++;
      }

      if (allProducts.length > 0) {
        updateState({ status: `AI分析開始... (全${allProducts.length}件)` });
        let processedCount = 0;
        
        const BATCH_SIZE = 3;
        for (let i = 0; i < allProducts.length; i += BATCH_SIZE) {
          if (stopRef.current) break;
          const batch = allProducts.slice(i, i + BATCH_SIZE);
          const promises = batch.map(item => 
            analyzeItemRisk(item, config.apiKey).then(res => ({ ...item, ...res }))
          );
          
          const batchResults = await Promise.all(promises);
          
          batchResults.forEach(res => {
            if (db && (res.risk_level === '高' || res.risk_level === '中' || res.is_critical)) {
              addDoc(collection(db, 'ip_checks'), {
                ...res, risk: res.risk_level, isCritical: res.is_critical, pic: currentUser.name, createdAt: serverTimestamp()
              }).catch(e => console.error(e));
            }
          });

          // Use functional update to append results
          setState(prev => ({
            ...prev,
            results: [...prev.results, ...batchResults.map(r => ({...r, risk: r.risk_level, isCritical: r.is_critical}))],
            progress: ((processedCount + batch.length) / allProducts.length) * 100
          }));
          
          processedCount += batch.length;
          await new Promise(r => setTimeout(r, 500)); 
        }
        addToast('チェックが完了しました', 'success');
        updateState({ status: '完了' });
      }
    } catch (e) {
      addToast(e.message, 'error');
      updateState({ status: 'エラー停止' });
    } finally {
      updateState({ isProcessing: false });
    }
  };

  // CSV Download
  const downloadCsv = () => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let csvContent = "商品名,リスク,危険度,理由,担当者,商品URL,日時\n";
    results.forEach(r => {
      const name = `"${(r.productName || '').replace(/"/g, '""')}"`;
      const reason = `"${(r.reason || '').replace(/"/g, '""')}"`;
      const itemUrl = `"${(r.itemUrl || '').replace(/"/g, '""')}"`;
      const date = new Date().toLocaleString();
      const critical = r.isCritical ? "★危険★" : "";
      csvContent += `${name},${r.risk},${critical},${reason},${currentUser.name},${itemUrl},${date}\n`;
    });
    const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `rakuten_check_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6 animate-in fade-in">
      <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm w-full">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><ShoppingBag className="w-5 h-5 text-blue-600"/> 楽天ショップ全商品取得＆AI判定</h2>
          {!config.rakutenAppId && <span className="text-xs font-bold text-red-500 bg-red-50 px-2 py-1 rounded">設定未完了</span>}
        </div>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <input type="text" value={targetUrl} onChange={e => updateState({ targetUrl: e.target.value })} className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="https://www.rakuten.co.jp/..." />
          </div>
          <div className="w-full md:w-40">
            <select value={maxPages} onChange={e => updateState({ maxPages: Number(e.target.value) })} className="w-full h-12 px-3 border rounded-lg bg-white">
              <option value="5">5ページ (150件)</option>
              <option value="34">全件 (最大)</option>
            </select>
          </div>
          {!isProcessing ? (
            <button onClick={handleSearch} className="w-full md:w-auto px-6 h-12 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm flex items-center justify-center gap-2"><Search className="w-4 h-4"/> 開始</button>
          ) : (
            <button onClick={() => stopRef.current = true} className="w-full md:w-auto px-6 h-12 bg-amber-500 text-white font-bold rounded-lg hover:bg-amber-600 shadow-sm flex items-center justify-center gap-2"><Pause className="w-4 h-4"/> 中断</button>
          )}
        </div>
        {status && <div className="mt-4 text-sm text-slate-500 flex items-center gap-2 bg-slate-50 p-2 rounded"><RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`}/> {status}</div>}
        {isProcessing && <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden mt-2"><div className="h-full bg-blue-500 transition-all duration-500" style={{width: `${progress}%`}}></div></div>}
      </div>

      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden w-full">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center">
            <h3 className="font-bold text-slate-700">判定結果 ({results.length})</h3>
            <button onClick={downloadCsv} className="text-sm font-bold text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded flex items-center gap-1"><Download className="w-4 h-4"/> CSV出力</button>
          </div>
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 sticky top-0 shadow-sm text-sm font-bold text-slate-600">
                <tr>
                  <th className="p-4 text-center w-32">判定</th>
                  <th className="p-4 text-center w-24">画像</th>
                  <th className="p-4">商品情報</th>
                  <th className="p-4 w-1/3">AI分析結果</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {results.map((item, i) => (
                  <tr key={i} className={`hover:bg-slate-50 ${item.isCritical ? 'bg-red-50' : ''}`}>
                    <td className="p-4 text-center align-top"><RiskBadge item={item} /></td>
                    <td className="p-4 align-top text-center">
                      {item.imageUrl ? <img src={item.imageUrl} className="w-16 h-16 object-contain border rounded bg-white mx-auto" alt="" /> : <div className="w-16 h-16 bg-slate-100 rounded mx-auto"/>}
                    </td>
                    <td className="p-4 align-top">
                      <div className="font-bold text-slate-800 line-clamp-2">{item.productName}</div>
                      {item.itemUrl && <a href={item.itemUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline mt-1 inline-flex items-center gap-1"><ExternalLink className="w-3 h-3"/> 商品ページ</a>}
                    </td>
                    <td className="p-4 align-top text-slate-600">{item.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const CsvSearchView = ({ config, db, currentUser, addToast, state, setState, stopRef }) => {
  const { files, results, isProcessing, progress } = state;
  const updateState = (updates) => setState(prev => ({ ...prev, ...updates }));

  const [encoding, setEncoding] = useState('Shift_JIS');
  const [targetColIndex, setTargetColIndex] = useState(0);
  const [headers, setHeaders] = useState([]);

  const handleFileUpload = async (e) => {
    const uploadedFiles = e.target.files ? Array.from(e.target.files) : [];
    if (uploadedFiles.length === 0) return;
    updateState({ files: uploadedFiles, results: [] });
    
    // Parse first file to get headers
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

    // Load all data
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

    const BATCH = 3;
    for(let i=0; i<allData.length; i+=BATCH) {
      if(stopRef.current) break;
      const batch = allData.slice(i, i+BATCH);
      const promises = batch.map(item => 
        item.productName ? analyzeItemRisk(item, config.apiKey).then(res => ({...item, ...res})) 
                         : Promise.resolve({...item, risk_level: '低', reason: '-'})
      );
      
      const resBatch = await Promise.all(promises);
      
      resBatch.forEach(res => {
        if(db && (res.risk_level === '高' || res.risk_level === '中' || res.is_critical)) {
           addDoc(collection(db, 'ip_checks'), { ...res, risk: res.risk_level, isCritical: res.is_critical, pic: currentUser.name, createdAt: serverTimestamp() });
        }
      });
      
      // Functional update for array
      setState(prev => ({
        ...prev,
        results: [...prev.results, ...resBatch.map(r => ({...r, risk: r.risk_level, isCritical: r.is_critical}))],
        progress: ((processed + batch.length) / totalItems) * 100
      }));
      
      processed += batch.length;
      await new Promise(r => setTimeout(r, 200));
    }
    updateState({ isProcessing: false });
    addToast('CSVチェック完了', 'success');
  };

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
      {results.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden w-full">
          <div className="p-4 border-b border-slate-100"><h3 className="font-bold">CSV判定結果</h3></div>
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 sticky top-0"><tr><th className="p-3 text-center">判定</th><th className="p-3">商品名</th><th className="p-3">理由</th></tr></thead>
              <tbody className="divide-y">{results.map((r,i)=><tr key={i}><td className="p-3 text-center"><RiskBadge item={r}/></td><td className="p-3">{r.productName}</td><td className="p-3 text-slate-500">{r.reason}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const HistoryView = ({ data }) => (
  <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-in fade-in w-full">
    <div className="p-4 border-b border-slate-100"><h2 className="font-bold text-slate-800">全チェック履歴</h2></div>
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-slate-600 font-bold">
          <tr><th className="p-4">日時</th><th className="p-4">担当</th><th className="p-4">判定</th><th className="p-4">商品名</th><th className="p-4">理由</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.map(item => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="p-4 text-xs text-slate-400 whitespace-nowrap">{item.createdAt?.seconds ? new Date(item.createdAt.seconds * 1000).toLocaleString() : '-'}</td>
              <td className="p-4 font-medium">{item.pic}</td>
              <td className="p-4"><RiskBadge item={item} /></td>
              <td className="p-4 font-medium line-clamp-2" title={item.productName}>{item.productName}</td>
              <td className="p-4 text-slate-600 text-xs">{item.reason}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

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
        <button onClick={handleSave} className="w-full py-3 bg-slate-800 text-white font-bold rounded-lg hover:bg-slate-900">設定を保存して適用</button>
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

  const [historyData, setHistoryData] = useState([]);
  const [userList, setUserList] = useState([]);

  // --- Lifted State for Persistent Tabs ---
  const [urlSearchState, setUrlSearchState] = useState({ targetUrl: '', results: [], isProcessing: false, progress: 0, status: '', maxPages: 5 });
  const urlSearchStopRef = useRef(false);

  const [csvSearchState, setCsvSearchState] = useState({ files: [], results: [], isProcessing: false, progress: 0 });
  const csvSearchStopRef = useRef(false);

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
      
      const q = query(collection(firestore, 'ip_checks'), orderBy('createdAt', 'desc'), limit(200));
      onSnapshot(q, (snap) => setHistoryData(snap.docs.map(d => ({ id: d.id, ...d.data() }))), 
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
    
    setConfig({ apiKey: savedApiKey, rakutenAppId: savedRakutenId, firebaseJson: savedFbConfig });
    if (savedFbConfig) initFirebase(savedFbConfig);
  }, []);

  const handleLogin = async (id, pass) => {
    if (id === 'admin' && pass === APP_CONFIG.FIXED_PASSWORD) {
      setCurrentUser({ name: '管理者(System)', role: 'admin' });
      addToast('管理者としてログインしました', 'success');
      return;
    }
    if (!db) return addToast('Firebase未接続のため初期管理者のみログイン可能です', 'error');

    try {
      const q = query(collection(db, 'app_users'), where('loginId', '==', id), where('password', '==', pass));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const userData = snap.docs[0].data();
        setCurrentUser({ name: userData.name, role: userData.role });
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
    setActiveTab('dashboard');
    addToast('ログアウトしました', 'info');
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
          {activeTab === 'dashboard' && <DashboardView historyData={historyData} onNavigate={setActiveTab} />}
          {activeTab === 'url' && <UrlSearchView config={config} db={db} currentUser={currentUser} addToast={addToast} state={urlSearchState} setState={setUrlSearchState} stopRef={urlSearchStopRef} />}
          {activeTab === 'checker' && <CsvSearchView config={config} db={db} currentUser={currentUser} addToast={addToast} state={csvSearchState} setState={setCsvSearchState} stopRef={csvSearchStopRef} />}
          {activeTab === 'history' && <HistoryView data={historyData} />}
          {activeTab === 'users' && <UserManagementView db={db} userList={userList} addToast={addToast} />}
          {activeTab === 'settings' && <SettingsView config={config} setConfig={setConfig} addToast={addToast} initFirebase={initFirebase} />}
        </main>
      </div>
    </div>
  );
}