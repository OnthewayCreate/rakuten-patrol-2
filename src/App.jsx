import React, { useState, useEffect, useRef } from 'react';
import { Upload, FileText, CheckCircle, Play, Download, Loader2, ShieldAlert, Pause, Trash2, Eye, Zap, FolderOpen, Lock, LogOut, History, Settings, Save, Search, Globe, ShoppingBag, AlertCircle, RefreshCw, ExternalLink, Siren, User } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getFirestore, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp } from 'firebase/firestore';

const FIXED_PASSWORD = 'admin123'; 

// ユーティリティ: CSVパース
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

// API呼び出しラッパー
async function checkIPRisk(itemData, apiKey, retryCount = 0) {
  try {
    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        productName: itemData.productName,
        imageUrl: itemData.imageUrl, 
        apiKey: apiKey
      })
    });

    if (response.status === 429 || response.status === 504) {
      if (retryCount < 5) { // リトライ回数を強化
        const waitTime = Math.pow(2, retryCount + 1) * 1000 + (Math.random() * 1000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return checkIPRisk(itemData, apiKey, retryCount + 1);
      } else {
        throw new Error("混雑中 (Rate Limit)");
      }
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`通信エラー: ${response.status}`);
    }

    return await response.json();

  } catch (error) {
    return { risk_level: "エラー", reason: error.message };
  }
}

export default function App() {
  // 認証・ユーザー情報
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [inputPassword, setInputPassword] = useState('');
  const [userName, setUserName] = useState(''); // 担当者名
  
  // 設定
  const [apiKey, setApiKey] = useState('');
  const [rakutenAppId, setRakutenAppId] = useState('');
  const [firebaseConfigJson, setFirebaseConfigJson] = useState('');
  const [db, setDb] = useState(null);
  
  // アプリ状態
  const [activeTab, setActiveTab] = useState('url');
  const [files, setFiles] = useState([]);
  const [csvData, setCsvData] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [targetColIndex, setTargetColIndex] = useState(-1);
  const [results, setResults] = useState([]);
  const [historyData, setHistoryData] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [encoding, setEncoding] = useState('Shift_JIS');
  const [isHighSpeed, setIsHighSpeed] = useState(false); 
  
  const [targetUrl, setTargetUrl] = useState('');
  const [urlStatus, setUrlStatus] = useState('');
  const [maxPages, setMaxPages] = useState(5);

  const stopRef = useRef(false);

  // 初期化
  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedRakutenId = localStorage.getItem('rakuten_app_id');
    const savedFbConfig = localStorage.getItem('firebase_config');
    const savedUser = localStorage.getItem('app_user_name');
    
    if (savedKey) setApiKey(savedKey);
    if (savedRakutenId) setRakutenAppId(savedRakutenId);
    if (savedUser) setUserName(savedUser);
    if (savedFbConfig) {
      setFirebaseConfigJson(savedFbConfig);
      initFirebase(savedFbConfig);
    }
  }, []);

  const initFirebase = (configStr) => {
    try {
      const config = JSON.parse(configStr);
      const app = initializeApp(config);
      const firestore = getFirestore(app);
      setDb(firestore);
      // 履歴をリアルタイム取得
      const q = query(collection(firestore, 'ip_checks'), orderBy('createdAt', 'desc'), limit(100));
      onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setHistoryData(docs);
      });
    } catch (e) {
      console.error("Firebase Init Error", e);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (inputPassword === FIXED_PASSWORD) {
      if (!userName.trim()) {
        alert("担当者名を入力してください（履歴に残ります）");
        return;
      }
      localStorage.setItem('app_user_name', userName);
      setIsAuthenticated(true);
    } else {
      alert("パスワードが違います");
    }
  };

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    localStorage.setItem('rakuten_app_id', rakutenAppId);
    localStorage.setItem('firebase_config', firebaseConfigJson);
    if (firebaseConfigJson) initFirebase(firebaseConfigJson);
    alert("設定を保存しました");
  };

  const saveToHistory = async (item) => {
    if (!db) return;
    try {
      // 「高」「中」または「危険フラグ」があるものを保存
      if (item.risk === '高' || item.risk === '中' || item.isCritical) {
        await addDoc(collection(db, 'ip_checks'), {
          productName: item.productName,
          risk: item.risk,
          reason: item.reason,
          sourceFile: item.sourceFile,
          imageUrl: item.imageUrl || '',
          isCritical: item.is_critical || false,
          pic: userName, // 担当者
          createdAt: serverTimestamp()
        });
      }
    } catch (e) { console.error("Save Error", e); }
  };

  const handleFileUpload = async (e) => {
    const uploadedFiles = e.target.files ? Array.from(e.target.files) : [];
    if (uploadedFiles.length === 0) return;
    setFiles(uploadedFiles);
    setResults([]);
    let combinedData = [];
    let commonHeaders = [];
    for (let i = 0; i < uploadedFiles.length; i++) {
      const file = uploadedFiles[i];
      try {
        const text = await readFileAsText(file, encoding);
        const parsed = parseCSV(text);
        if (parsed.length > 0) {
          const fileHeaders = parsed[0];
          const fileRows = parsed.slice(1);
          if (i === 0) {
            commonHeaders = [...fileHeaders, "元ファイル名"];
            setHeaders(commonHeaders);
            const nameIndex = fileHeaders.findIndex(h => h.includes('商品名') || h.includes('Name') || h.includes('Product'));
            setTargetColIndex(nameIndex !== -1 ? nameIndex : 0);
          }
          const rowsWithFileName = fileRows.map(row => [...row, file.name]); 
          combinedData = [...combinedData, ...rowsWithFileName];
        }
      } catch (err) { alert(`${file.name} の読み込み失敗`); }
    }
    setCsvData(combinedData);
  };

  // --- 楽天API検索 (ページネーション対応) ---
  const handleRakutenSearch = async () => {
    if (!targetUrl) return alert("ショップURLを入力してください");
    if (!rakutenAppId) return alert("設定画面で「楽天アプリID」を入力してください");
    
    if (window.location.hostname.includes('stackblitz') || window.location.hostname.includes('webcontainer')) {
      alert("【注意】StackBlitzプレビューでは動作しません。Vercel環境で実行してください。");
      return;
    }

    setResults([]);
    setIsProcessing(true);
    stopRef.current = false;
    setUrlStatus('取得開始...');

    let allProducts = [];
    let currentPage = 1;
    let totalPages = 1;

    try {
      while (currentPage <= maxPages && currentPage <= totalPages) {
        if (stopRef.current) {
          setUrlStatus('中断しました');
          break;
        }

        setUrlStatus(`データ取得中... (${currentPage}ページ目 / ${allProducts.length}件取得済)`);
        
        const apiUrl = new URL('/api/rakuten', window.location.origin);
        apiUrl.searchParams.append('shopUrl', targetUrl);
        apiUrl.searchParams.append('appId', rakutenAppId);
        apiUrl.searchParams.append('page', currentPage.toString());

        const res = await fetch(apiUrl.toString());
        
        if (!res.ok) {
          setUrlStatus(`取得エラー: ${res.status}`);
          break;
        }
        
        const data = await res.json();
        if (!data.products || data.products.length === 0) {
          if (currentPage === 1) setUrlStatus('商品が見つかりませんでした');
          break; 
        }

        if (currentPage === 1) totalPages = data.pageCount;

        const pageProducts = data.products.map(p => ({
          productName: p.name,
          sourceFile: targetUrl,
          imageUrl: p.imageUrl,
          itemUrl: p.url
        }));

        allProducts = [...allProducts, ...pageProducts];
        
        // 楽天API制限考慮 (1秒待機)
        await new Promise(resolve => setTimeout(resolve, 1000));
        currentPage++;
      }

      if (allProducts.length > 0) {
        setUrlStatus(`${allProducts.length}件の商品をチェック中...`);
        await startCheckProcess(allProducts, true);
        setUrlStatus('完了');
      }

    } catch (e) {
      setUrlStatus(`エラー: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 共通チェックプロセス (高速化・並列処理) ---
  const startCheckProcess = async (dataList, isApiMode = false) => {
    if (!apiKey) return alert("設定画面でAPIキーを入力してください");
    setIsProcessing(true);
    stopRef.current = false;
    let currentIndex = 0;
    const total = dataList.length;
    
    // 高速モード: 5並列 / 通常: 1並列 (画像解析は重いため控えめに)
    const BATCH_SIZE = isHighSpeed ? 5 : 1; 
    
    while (currentIndex < total) {
      if (stopRef.current) break;
      const batchEnd = Math.min(currentIndex + BATCH_SIZE, total);
      const promises = [];

      for (let i = currentIndex; i < batchEnd; i++) {
        let itemData = {};
        if (isApiMode) {
          itemData = dataList[i];
        } else {
          const row = dataList[i];
          const pName = row[targetColIndex];
          const src = row[row.length - 1];
          itemData = { productName: pName, sourceFile: src, imageUrl: null, itemUrl: null };
        }

        if (!itemData.productName) {
          promises.push(Promise.resolve({ ...itemData, id: i, risk: "低", reason: "-" }));
          continue;
        }

        promises.push(checkIPRisk(itemData, apiKey).then(res => ({
          ...itemData,
          id: i, 
          risk: res.risk_level, 
          isCritical: res.is_critical, // 危険フラグ
          reason: res.reason
        })));
      }

      const batchResults = await Promise.all(promises);
      setResults(prev => [...prev, ...batchResults]);
      batchResults.forEach(item => saveToHistory(item));
      
      setProgress(Math.round((batchEnd / total) * 100));
      currentIndex = batchEnd;
      
      // 待機時間調整 (高速モードなら短縮)
      const waitTime = isHighSpeed ? 200 : 2000;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    setIsProcessing(false);
  };

  const startCsvProcessing = () => startCheckProcess(csvData, false);

  const downloadCSV = (dataToDownload) => {
    const bom = new Uint8Array([0xEF, 0xBB, 0xBF]);
    let csvContent = "商品名,リスク,危険度,理由,担当者,ソース,商品URL,日時\n";
    dataToDownload.forEach(r => {
      const name = `"${(r.productName || '').replace(/"/g, '""')}"`;
      const reason = `"${(r.reason || '').replace(/"/g, '""')}"`;
      const file = `"${(r.sourceFile || '').replace(/"/g, '""')}"`;
      const itemUrl = `"${(r.itemUrl || '').replace(/"/g, '""')}"`;
      const date = r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleString() : new Date().toLocaleString();
      const critical = r.isCritical ? "★危険★" : "";
      csvContent += `${name},${r.risk},${critical},${reason},${userName},${file},${itemUrl},${date}\n`;
    });
    const blob = new Blob([bom, csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "ip_check_report.csv");
    document.body.appendChild(link);
    link.click(); document.body.removeChild(link);
  };

  // バッジ表示ロジック
  const getRiskBadge = (item) => {
    const risk = item.risk;
    const isCritical = item.isCritical;

    if (isCritical) {
        // 文言を修正
        return <span className="px-3 py-1 rounded-full text-sm font-bold bg-purple-600 text-white flex items-center justify-center gap-1 shadow-sm animate-pulse"><Siren className="w-4 h-4"/> 重大な疑い (要即時対応)</span>;
    }
    if (risk === '高' || risk === 'High') return <span className="px-3 py-1 rounded-full text-sm font-bold bg-red-100 text-red-700 border border-red-200">高 (危険)</span>;
    if (risk === '中' || risk === 'Medium') return <span className="px-3 py-1 rounded-full text-sm font-bold bg-yellow-100 text-yellow-700 border border-yellow-200">中 (要確認)</span>;
    return <span className="px-3 py-1 rounded-full text-sm font-bold bg-green-100 text-green-700 border border-green-200">問題なし</span>;
  };

  // --- ログイン画面 ---
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full space-y-6">
          <div className="text-center">
            <div className="inline-flex p-3 bg-blue-100 rounded-full mb-4"><ShieldAlert className="w-8 h-8 text-blue-600" /></div>
            <h1 className="text-2xl font-bold text-slate-800">楽天パトロール</h1>
            <p className="text-sm text-slate-500 mt-2">弁理士AIによる権利侵害チェック</p>
          </div>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">担当者名 <span className="text-red-500">*</span></label>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
                <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="山田 太郎" required />
              </div>
              <p className="text-xs text-slate-500 mt-1">※作業履歴に記録されます</p>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1">パスワード</label>
              <div className="relative">
                <Lock className="w-5 h-5 absolute left-3 top-2.5 text-slate-400" />
                <input type="password" value={inputPassword} onChange={(e) => setInputPassword(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none" placeholder="パスワード" />
              </div>
            </div>
            <button type="submit" className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 transition-colors shadow-md">ログインして開始</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col">
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="w-full px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-slate-800 text-lg">
            <ShieldAlert className="w-6 h-6 text-blue-600" />
            <span>Rakuten Patrol</span>
          </div>
          <div className="flex items-center gap-1">
            {['url', 'checker', 'history', 'settings'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${activeTab === tab ? 'bg-blue-100 text-blue-700' : 'text-slate-500 hover:bg-slate-100'}`}>
                {tab === 'url' && '楽天URL検索'}
                {tab === 'checker' && 'CSV検索'}
                {tab === 'history' && '履歴'}
                {tab === 'settings' && '設定'}
              </button>
            ))}
            <div className="w-px h-6 bg-slate-300 mx-2"></div>
            <span className="text-xs text-slate-500 mr-2 font-medium"><User className="w-3 h-3 inline mr-1"/>{userName}</span>
            <button onClick={() => setIsAuthenticated(false)} className="p-2 text-slate-400 hover:text-red-500 rounded-full hover:bg-red-50"><LogOut className="w-5 h-5" /></button>
          </div>
        </div>
      </nav>

      <main className="flex-1 w-full px-6 py-6">
        {/* --- URL検索 --- */}
        {activeTab === 'url' && (
          <div className="space-y-6 w-full animate-in fade-in">
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2"><ShoppingBag className="w-6 h-6 text-blue-600" /> 楽天ショップの商品を自動取得</h2>
                {!rakutenAppId && <span className="text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full animate-bounce">⚠ 設定で楽天アプリIDを入力してください</span>}
              </div>
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1 space-y-1">
                  <label className="text-xs font-bold text-slate-500">ショップURL</label>
                  <input type="text" value={targetUrl} onChange={(e) => setTargetUrl(e.target.value)} placeholder="https://www.rakuten.co.jp/shop-name/" className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-lg" />
                </div>
                <div className="w-48 space-y-1">
                  <label className="text-xs font-bold text-slate-500">取得ページ数</label>
                  <select value={maxPages} onChange={(e) => setMaxPages(Number(e.target.value))} className="w-full px-3 py-3 border rounded-lg bg-white font-medium">
                    <option value="1">1ページ (30件)</option>
                    <option value="5">5ページ (150件)</option>
                    <option value="10">10ページ (300件)</option>
                    <option value="34">全件 (最大1000件)</option>
                  </select>
                </div>
                <div className="flex items-end">
                  {!isProcessing ? (
                    <button onClick={handleRakutenSearch} disabled={!rakutenAppId} className="h-12 px-8 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-sm flex items-center gap-2 transition-all">
                      <Search className="w-5 h-5" /> 取得＆チェック開始
                    </button>
                  ) : (
                    <button onClick={() => {stopRef.current = true;}} className="h-12 px-8 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-sm flex items-center gap-2 transition-all">
                      <Pause className="w-5 h-5" /> 中断する
                    </button>
                  )}
                </div>
              </div>
              {urlStatus && <div className="bg-slate-50 p-3 rounded text-slate-600 font-mono text-sm flex items-center gap-2"><RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} /> {urlStatus}</div>}
              {isProcessing && <div className="h-1 w-full bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }}></div></div>}
            </div>

            {results.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center">
                  <h2 className="font-bold text-slate-700 flex items-center gap-2"><CheckCircle className="w-5 h-5 text-green-600" /> 判定結果 ({results.length}件)</h2>
                  <button onClick={() => downloadCSV(results)} className="px-4 py-2 text-sm font-bold text-blue-600 hover:bg-blue-50 rounded-lg transition-colors flex items-center gap-2"><Download className="w-4 h-4" /> CSVダウンロード</button>
                </div>
                <div className="overflow-x-auto max-h-[75vh]">
                  <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm text-sm font-bold text-slate-600">
                      <tr>
                        <th className="p-4 text-center w-32">判定</th>
                        <th className="p-4 text-center w-24">画像</th>
                        <th className="p-4 min-w-[300px]">商品名 / URL</th>
                        <th className="p-4 w-1/3 min-w-[300px]">弁理士AIの指摘</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-sm">
                      {results.map((item, idx) => (
                        <tr key={idx} className={`hover:bg-slate-50 transition-colors ${item.isCritical ? 'bg-red-50' : ''}`}>
                          <td className="p-4 text-center align-top">{getRiskBadge(item)}</td>
                          <td className="p-4 align-top">
                            {item.imageUrl ? (
                              <a href={item.itemUrl} target="_blank" rel="noreferrer" className="block w-20 h-20 mx-auto bg-white rounded border border-slate-200 overflow-hidden hover:scale-105 transition-transform">
                                <img src={item.imageUrl} alt="" className="w-full h-full object-contain" />
                              </a>
                            ) : <div className="w-20 h-20 bg-slate-100 rounded mx-auto flex items-center justify-center text-xs text-slate-400">No Img</div>}
                          </td>
                          <td className="p-4 align-top">
                            <div className="font-bold text-slate-700 mb-1">{item.productName}</div>
                            {item.itemUrl && (
                              <a href={item.itemUrl} target="_blank" rel="noreferrer" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                                <ExternalLink className="w-3 h-3" /> 商品ページを開く
                              </a>
                            )}
                          </td>
                          <td className="p-4 align-top text-slate-700 leading-relaxed">
                            {item.isCritical && <div className="text-xs font-bold text-red-600 mb-1 flex items-center gap-1"><Siren className="w-3 h-3"/> 重大な権利侵害の疑い (要即時対応)</div>}
                            {item.reason}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* --- 履歴画面 --- */}
        {activeTab === 'history' && (
          <div className="space-y-6 animate-in fade-in w-full">
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex justify-between items-center">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><History className="w-6 h-6 text-blue-600" /> チェック履歴 (最新100件)</h2>
                {!db && <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded">Firebase未接続</span>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="bg-slate-50 text-slate-600 font-bold">
                    <tr>
                      <th className="p-4 w-40">日時</th>
                      <th className="p-4 w-32">担当者</th>
                      <th className="p-4 w-32 text-center">判定</th>
                      <th className="p-4">商品名</th>
                      <th className="p-4 w-1/3">理由</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyData.map((item) => (
                      <tr key={item.id} className={`hover:bg-slate-50 ${item.isCritical ? 'bg-red-50' : ''}`}>
                        <td className="p-4 text-slate-500 text-xs whitespace-nowrap">
                          {item.createdAt ? new Date(item.createdAt.seconds * 1000).toLocaleString() : '-'}
                        </td>
                        <td className="p-4 font-medium text-slate-700 flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-400"/> {item.pic || '不明'}
                        </td>
                        <td className="p-4 text-center">{getRiskBadge(item)}</td>
                        <td className="p-4 font-medium text-slate-700 line-clamp-2" title={item.productName}>{item.productName}</td>
                        <td className="p-4 text-slate-600 text-xs">{item.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- CSV & 設定タブ (省略なしで実装) --- */}
        {activeTab === 'checker' && (
          <div className="space-y-6 animate-in fade-in w-full">
             <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4">
                <div className="flex flex-col md:flex-row gap-4">
                  <div className="flex-1 border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 relative">
                    <input type="file" accept=".csv" multiple onChange={handleFileUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <FolderOpen className="w-10 h-10 text-slate-400 mx-auto mb-2" />
                    <p className="font-bold text-slate-600">CSVファイルをドラッグ＆ドロップ</p>
                    <p className="text-xs text-slate-400">{files.length}ファイル選択中</p>
                  </div>
                  <div className="w-64 space-y-2">
                    <select value={encoding} onChange={(e) => setEncoding(e.target.value)} className="w-full p-2 border rounded bg-white"><option value="Shift_JIS">Shift_JIS (楽天)</option><option value="UTF-8">UTF-8 (一般)</option></select>
                    <select value={targetColIndex} onChange={(e) => setTargetColIndex(Number(e.target.value))} className="w-full p-2 border rounded bg-white" disabled={headers.length === 0}>
                      {headers.length === 0 && <option>カラム未選択</option>}
                      {headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                    </select>
                    <div onClick={() => setIsHighSpeed(!isHighSpeed)} className={`p-2 rounded cursor-pointer border flex items-center gap-2 ${isHighSpeed ? 'bg-indigo-50 border-indigo-200' : 'bg-slate-50'}`}>
                      <Zap className={`w-4 h-4 ${isHighSpeed ? 'text-indigo-600' : 'text-slate-400'}`} />
                      <span className="text-xs font-bold">高速モード {isHighSpeed ? 'ON' : 'OFF'}</span>
                    </div>
                  </div>
                </div>
                <button onClick={startCsvProcessing} disabled={files.length === 0 || isProcessing} className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-sm">
                  {isProcessing ? 'AIチェック実行中...' : 'CSVチェック開始'}
                </button>
             </div>
             {results.length > 0 && (
               <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                 <div className="p-4 border-b flex justify-between items-center">
                   <h3 className="font-bold">判定結果 ({results.length}件)</h3>
                   <button onClick={() => downloadCSV(results)} className="text-blue-600 text-sm hover:underline">CSVダウンロード</button>
                 </div>
                 <div className="max-h-[600px] overflow-auto">
                   <table className="w-full text-sm text-left">
                     <thead className="bg-slate-50 sticky top-0">
                       <tr><th className="p-3 text-center">判定</th><th className="p-3">商品名</th><th className="p-3">理由</th></tr>
                     </thead>
                     <tbody className="divide-y">
                       {results.map((r, i) => (
                         <tr key={i} className={r.isCritical ? 'bg-red-50' : ''}>
                           <td className="p-3 text-center">{getRiskBadge(r)}</td>
                           <td className="p-3 font-medium">{r.productName}</td>
                           <td className="p-3 text-slate-600">{r.reason}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
             )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 max-w-2xl mx-auto animate-in fade-in">
            <h2 className="text-xl font-bold mb-6 flex items-center gap-2"><Settings className="w-6 h-6" /> 設定</h2>
            <div className="space-y-6">
              <div>
                <label className="block font-bold text-sm mb-1">Gemini API Key</label>
                <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} className="w-full p-3 border rounded-lg" placeholder="AIza..." />
              </div>
              <div>
                <label className="block font-bold text-sm mb-1">楽天アプリID</label>
                <input type="text" value={rakutenAppId} onChange={(e) => setRakutenAppId(e.target.value)} className="w-full p-3 border rounded-lg" placeholder="100..." />
              </div>
              <div>
                <label className="block font-bold text-sm mb-1">Firebase Config (JSON)</label>
                <textarea value={firebaseConfigJson} onChange={(e) => setFirebaseConfigJson(e.target.value)} className="w-full p-3 border rounded-lg h-32 font-mono text-xs" placeholder='{"apiKey": "..."}' />
              </div>
              <button onClick={saveSettings} className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700">設定を保存</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}