import React, { useState, useEffect, useRef } from 'react';
import {
  Upload,
  FileText,
  CheckCircle,
  Play,
  Download,
  Loader2,
  ShieldAlert,
  Pause,
  Trash2,
  Eye,
  Zap,
  FolderOpen,
  Lock,
  LogOut,
  History,
  Settings,
  Save,
  Search,
  Globe,
  ShoppingBag,
  AlertCircle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  addDoc,
  query,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
} from 'firebase/firestore';

const FIXED_PASSWORD = 'admin123';

const parseCSV = (text) => {
  const rows = [];
  let currentRow = [];
  let currentField = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField);
      currentField = '';
      if (currentRow.length > 0) rows.push(currentRow);
      currentRow = [];
    } else {
      currentField += char;
    }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }
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

async function checkIPRisk(productName, apiKey, retryCount = 0) {
  const systemInstruction = `
あなたはECモールの知的財産権保護担当者です。
ユーザーから渡された「商品名」を分析し、以下の基準でリスク判定を行ってください。
【判定基準】
1. 商標権: 有名ブランド名、キャラクター名、登録商標が含まれているか？
2. 意匠権: 「〇〇風」「〇〇タイプ」など、模倣の意図が見えるか？
3. 著作権: アニメ、映画、ゲームなどの著作物名を無断使用していそうか？
【注意点】
- 「〇〇対応」といった互換品の説明は、権利侵害ではない場合が多いが、念のため"Medium"として報告する。
- 一般名詞（机、椅子など）だけのものは "Low" とする。
【出力フォーマット】JSONのみ
{"risk_level": "High" or "Medium" or "Low", "reason": "短い理由"}
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
  const payload = {
    contents: [{ parts: [{ text: `商品名: ${productName}` }] }],
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { responseMimeType: 'application/json' },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 429) {
      if (retryCount < 10) {
        const waitTime =
          Math.pow(2, retryCount + 1) * 1000 + Math.random() * 1000;
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return checkIPRisk(productName, apiKey, retryCount + 1);
      } else {
        throw new Error('APIレート制限超過');
      }
    }
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('No response');
    return JSON.parse(text);
  } catch (error) {
    return { risk_level: 'Error', reason: error.message };
  }
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [inputPassword, setInputPassword] = useState('');

  const [apiKey, setApiKey] = useState('');
  const [rakutenAppId, setRakutenAppId] = useState('');
  const [firebaseConfigJson, setFirebaseConfigJson] = useState('');
  const [db, setDb] = useState(null);

  const [activeTab, setActiveTab] = useState('url'); // デフォルトをURL検索に
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

  useEffect(() => {
    const savedKey = localStorage.getItem('gemini_api_key');
    const savedRakutenId = localStorage.getItem('rakuten_app_id');
    const savedFbConfig = localStorage.getItem('firebase_config');
    if (savedKey) setApiKey(savedKey);
    if (savedRakutenId) setRakutenAppId(savedRakutenId);
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
      const q = query(
        collection(firestore, 'ip_checks'),
        orderBy('createdAt', 'desc'),
        limit(50)
      );
      onSnapshot(q, (snapshot) => {
        const docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
        setHistoryData(docs);
      });
    } catch (e) {
      console.error('Firebase Init Error', e);
    }
  };

  const handleLogin = (e) => {
    e.preventDefault();
    if (inputPassword === FIXED_PASSWORD) setIsAuthenticated(true);
    else alert('パスワードが違います');
  };

  const saveSettings = () => {
    localStorage.setItem('gemini_api_key', apiKey);
    localStorage.setItem('rakuten_app_id', rakutenAppId);
    localStorage.setItem('firebase_config', firebaseConfigJson);
    if (firebaseConfigJson) initFirebase(firebaseConfigJson);
    alert('設定を保存しました');
  };

  const saveToHistory = async (item) => {
    if (!db) return;
    try {
      if (item.risk === 'High' || item.risk === 'Medium') {
        await addDoc(collection(db, 'ip_checks'), {
          productName: item.productName,
          risk: item.risk,
          reason: item.reason,
          sourceFile: item.sourceFile,
          createdAt: serverTimestamp(),
        });
      }
    } catch (e) {
      console.error('Save Error', e);
    }
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
            commonHeaders = [...fileHeaders, '元ファイル名'];
            setHeaders(commonHeaders);
            const nameIndex = fileHeaders.findIndex(
              (h) =>
                h.includes('商品名') ||
                h.includes('Name') ||
                h.includes('Product')
            );
            setTargetColIndex(nameIndex !== -1 ? nameIndex : 0);
          }
          const rowsWithFileName = fileRows.map((row) => [...row, file.name]);
          combinedData = [...combinedData, ...rowsWithFileName];
        }
      } catch (err) {
        alert(`${file.name} の読み込み失敗`);
      }
    }
    setCsvData(combinedData);
  };

  const handleRakutenSearch = async () => {
    if (!targetUrl) return alert('ショップURLを入力してください');
    if (!rakutenAppId)
      return alert('設定画面で「楽天アプリID」を入力してください');

    if (
      window.location.hostname.includes('stackblitz') ||
      window.location.hostname.includes('webcontainer')
    ) {
      alert(
        '【注意】この機能はStackBlitzプレビューでは動作しません。Vercelデプロイ後に実行してください。'
      );
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
          setUrlStatus('取得を中断しました');
          break;
        }

        setUrlStatus(
          `楽天からデータ取得中... (${currentPage}ページ目 / ${allProducts.length}件)`
        );

        const apiUrl = new URL('/api/rakuten', window.location.origin);
        apiUrl.searchParams.append('shopUrl', targetUrl);
        apiUrl.searchParams.append('appId', rakutenAppId);
        apiUrl.searchParams.append('page', currentPage.toString());

        const res = await fetch(apiUrl.toString());

        if (!res.ok) {
          const errorData = await res.json().catch(async () => {
            const text = await res.text();
            return { error: `API Error (${res.status})`, details: text };
          });
          setUrlStatus(
            `エラー: ${errorData.error || 'API呼び出しに失敗しました'}`
          );
          break;
        }

        const data = await res.json();
        if (!data.products || data.products.length === 0) {
          if (currentPage === 1) setUrlStatus('商品が見つかりませんでした。');
          break;
        }

        if (currentPage === 1) totalPages = data.pageCount;

        const pageProducts = data.products.map((p) => ({
          productName: p.name,
          sourceFile: targetUrl,
          imageUrl: p.imageUrl,
          itemUrl: p.url,
        }));

        allProducts = [...allProducts, ...pageProducts];
        await new Promise((resolve) => setTimeout(resolve, 1000));
        currentPage++;
      }

      if (allProducts.length > 0) {
        setUrlStatus(
          `${allProducts.length}件の商品を取得しました。AIチェックを開始します...`
        );
        await startCheckProcess(allProducts, true);
        setUrlStatus('完了');
      }
    } catch (e) {
      setUrlStatus(`エラー: ${e.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const startCheckProcess = async (dataList, isApiMode = false) => {
    if (!apiKey) return alert('設定画面でGemini APIキーを入力してください');
    setIsProcessing(true);
    stopRef.current = false;
    let currentIndex = 0;
    const total = dataList.length;
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
          itemData = {
            productName: pName,
            sourceFile: src,
            imageUrl: null,
            itemUrl: null,
          };
        }

        if (!itemData.productName) {
          promises.push(
            Promise.resolve({ ...itemData, id: i, risk: 'Low', reason: 'なし' })
          );
          continue;
        }

        promises.push(
          checkIPRisk(itemData.productName, apiKey).then((res) => ({
            ...itemData,
            id: i,
            risk: res.risk_level,
            reason: res.reason,
          }))
        );
      }

      const batchResults = await Promise.all(promises);
      setResults((prev) => [...prev, ...batchResults]);
      batchResults.forEach((item) => saveToHistory(item));

      setProgress(Math.round((batchEnd / total) * 100));
      currentIndex = batchEnd;
      const waitTime = isHighSpeed ? 100 : 4000;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    setIsProcessing(false);
  };

  const startCsvProcessing = () => {
    startCheckProcess(csvData, false);
  };

  const downloadCSV = (dataToDownload) => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf]);
    let csvContent = '商品名,リスク,理由,ソース,商品URL,画像URL,日時\n';
    dataToDownload.forEach((r) => {
      const name = `"${(r.productName || '').replace(/"/g, '""')}"`;
      const reason = `"${(r.reason || '').replace(/"/g, '""')}"`;
      const file = `"${(r.sourceFile || '').replace(/"/g, '""')}"`;
      const itemUrl = `"${(r.itemUrl || '').replace(/"/g, '""')}"`;
      const imgUrl = `"${(r.imageUrl || '').replace(/"/g, '""')}"`;
      const date = r.createdAt
        ? new Date(r.createdAt.seconds * 1000).toLocaleString()
        : '';
      csvContent += `${name},${r.risk},${reason},${file},${itemUrl},${imgUrl},${date}\n`;
    });
    const blob = new Blob([bom, csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'ip_check_result.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const getRiskBadge = (risk) => {
    const colors = {
      High: 'bg-red-100 text-red-800 border-red-200',
      Medium: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      Low: 'bg-green-100 text-green-800 border-green-200',
    };
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-bold border ${
          colors[risk] || 'bg-gray-100'
        }`}
      >
        {risk}
      </span>
    );
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-xl shadow-lg max-w-md w-full">
          <div className="flex justify-center mb-4">
            <Lock className="w-12 h-12 text-blue-600" />
          </div>
          <h1 className="text-2xl font-bold text-center text-slate-800 mb-6">
            楽天パトロール
          </h1>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">
                パスワード
              </label>
              <input
                type="password"
                value={inputPassword}
                onChange={(e) => setInputPassword(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                placeholder="パスワードを入力"
              />
            </div>
            <button
              type="submit"
              className="w-full bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700"
            >
              ログイン
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-800 flex flex-col">
      {/* ナビゲーションバー */}
      <nav className="bg-white border-b border-slate-200 sticky top-0 z-20 shadow-sm">
        <div className="w-full px-4 md:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <ShieldAlert className="w-6 h-6 text-blue-600" />
            <span className="hidden md:inline">Rakuten Patrol</span>
            <span className="md:hidden">RP</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab('url')}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'url'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <ShoppingBag className="w-4 h-4" />{' '}
              <span className="hidden sm:inline">楽天URL</span>
            </button>
            <button
              onClick={() => setActiveTab('checker')}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'checker'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <FileText className="w-4 h-4" />{' '}
              <span className="hidden sm:inline">CSV</span>
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'history'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <History className="w-4 h-4" />{' '}
              <span className="hidden sm:inline">履歴</span>
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap flex items-center gap-1 ${
                activeTab === 'settings'
                  ? 'bg-blue-50 text-blue-600'
                  : 'text-slate-500 hover:bg-slate-50'
              }`}
            >
              <Settings className="w-4 h-4" />{' '}
              <span className="hidden sm:inline">設定</span>
            </button>
            <button
              onClick={() => setIsAuthenticated(false)}
              className="ml-2 p-2 text-slate-400 hover:text-red-500"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      {/* メインコンテンツエリア (幅制限完全撤廃) */}
      <main className="flex-1 w-full px-4 py-6 md:px-8">
        {/* --- URL検索画面 --- */}
        {activeTab === 'url' && (
          <div className="space-y-6 animate-in fade-in w-full">
            {/* 検索パネル (max-w無し) */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4 w-full">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <ShoppingBag className="w-5 h-5 text-blue-600" />{' '}
                  楽天ショップの商品を取得
                </h2>
                {!rakutenAppId && (
                  <span className="text-xs text-red-500 font-bold bg-red-50 px-2 py-1 rounded">
                    ※設定で楽天アプリIDを入力してください
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-4 md:flex-row">
                <div className="flex-1 space-y-2">
                  <input
                    type="text"
                    value={targetUrl}
                    onChange={(e) => setTargetUrl(e.target.value)}
                    placeholder="楽天のショップURL (例: https://www.rakuten.co.jp/edion/ )"
                    className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                  <div className="flex items-center gap-2 text-sm text-slate-600">
                    <span>最大取得ページ数:</span>
                    <select
                      value={maxPages}
                      onChange={(e) => setMaxPages(Number(e.target.value))}
                      className="border rounded px-2 py-1 bg-white"
                    >
                      <option value="1">1ページ (30件)</option>
                      <option value="5">5ページ (150件)</option>
                      <option value="10">10ページ (300件)</option>
                      <option value="34">34ページ (約1000件)</option>
                      <option value="100">100ページ (約3000件)</option>
                    </select>
                  </div>
                </div>
                <div>
                  {!isProcessing ? (
                    <button
                      onClick={handleRakutenSearch}
                      disabled={!rakutenAppId}
                      className="h-full px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-sm whitespace-nowrap flex items-center gap-2"
                    >
                      <Search className="w-4 h-4" /> 取得＆チェック開始
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        stopRef.current = true;
                      }}
                      className="h-full px-6 py-2 bg-amber-500 hover:bg-amber-600 text-white font-bold rounded-lg shadow-sm whitespace-nowrap flex items-center gap-2"
                    >
                      <Pause className="w-4 h-4" /> 中断する
                    </button>
                  )}
                </div>
              </div>

              {urlStatus && (
                <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 p-3 rounded animate-pulse">
                  <RefreshCw
                    className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`}
                  />
                  {urlStatus}
                </div>
              )}

              {isProcessing && (
                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden mt-2">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>

            {/* 結果リスト (max-w無し) */}
            {results.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                  <h2 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                    <CheckCircle className="w-4 h-4" /> 判定結果 (
                    {results.length}件)
                  </h2>
                  <button
                    onClick={() => downloadCSV(results)}
                    className="text-sm text-blue-600 flex items-center gap-1 hover:bg-blue-50 px-3 py-1 rounded transition-colors"
                  >
                    <Download className="w-4 h-4" /> CSV保存
                  </button>
                </div>
                <div className="overflow-x-auto max-h-[80vh] overflow-y-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                      <tr>
                        <th className="px-4 py-3 w-24 text-center bg-slate-50">
                          リスク
                        </th>
                        <th className="px-4 py-3 w-24 text-center bg-slate-50">
                          画像
                        </th>
                        <th className="px-4 py-3 bg-slate-50 min-w-[300px]">
                          商品名
                        </th>
                        <th className="px-4 py-3 w-1/3 min-w-[250px] bg-slate-50">
                          理由
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {results.map((item, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-slate-50 transition-colors"
                        >
                          <td className="px-4 py-3 text-center align-middle">
                            {getRiskBadge(item.risk)}
                          </td>
                          <td className="px-4 py-3 text-center align-middle">
                            {item.imageUrl ? (
                              <a
                                href={item.itemUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="block w-16 h-16 mx-auto"
                              >
                                <img
                                  src={item.imageUrl}
                                  alt="商品"
                                  className="w-full h-full object-contain rounded border border-slate-200 hover:opacity-80 bg-white"
                                />
                              </a>
                            ) : (
                              <div className="w-16 h-16 mx-auto bg-slate-100 rounded flex items-center justify-center text-xs text-slate-400">
                                No Img
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 align-middle">
                            <a
                              href={item.itemUrl || '#'}
                              target="_blank"
                              rel="noreferrer"
                              className="font-medium text-blue-600 hover:underline block"
                              title={item.productName}
                            >
                              {item.productName}
                            </a>
                            <div className="flex items-center gap-1 mt-1 text-xs text-slate-400">
                              <ExternalLink className="w-3 h-3" /> 商品ページへ
                            </div>
                          </td>
                          <td className="px-4 py-3 text-slate-600 align-middle text-sm">
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

        {/* --- CSVチェッカー画面 --- */}
        {activeTab === 'checker' && (
          <div className="space-y-6 animate-in fade-in w-full">
            {/* CSVパネル (max-w無し) */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 space-y-4 w-full">
              <div className="flex flex-col md:flex-row gap-4">
                <div className="flex-1">
                  {files.length === 0 ? (
                    <div className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:bg-slate-50 relative cursor-pointer transition-colors">
                      <input
                        type="file"
                        accept=".csv"
                        multiple
                        onChange={handleFileUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <FolderOpen className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                      <p className="text-slate-700 font-medium">
                        CSVファイルをドラッグ＆ドロップ
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        またはクリックして選択
                      </p>
                    </div>
                  ) : (
                    <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex justify-between items-center">
                      <div>
                        <span className="font-bold text-blue-900 block flex items-center gap-2">
                          <FileText className="w-4 h-4" /> 読み込み済み:{' '}
                          {files.length}ファイル
                        </span>
                        <span className="text-xs text-blue-600 ml-6">
                          合計 {csvData.length} 件のデータ
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setFiles([]);
                          setCsvData([]);
                          setResults([]);
                        }}
                        className="text-blue-400 hover:text-blue-600 p-2 rounded hover:bg-blue-100"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="w-full md:w-64 space-y-3">
                  <select
                    value={encoding}
                    onChange={(e) => setEncoding(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  >
                    <option value="Shift_JIS">Shift_JIS (楽天)</option>
                    <option value="UTF-8">UTF-8 (一般)</option>
                  </select>
                  <select
                    value={targetColIndex}
                    onChange={(e) => setTargetColIndex(Number(e.target.value))}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                    disabled={headers.length === 0}
                  >
                    {headers.length === 0 && <option>カラム未選択</option>}
                    {headers.map((h, i) => (
                      <option key={i} value={i}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <div
                    className="flex items-center gap-2 p-2 bg-slate-100 rounded-lg cursor-pointer hover:bg-slate-200 transition-colors"
                    onClick={() => setIsHighSpeed(!isHighSpeed)}
                  >
                    <Zap
                      className={`w-4 h-4 ${
                        isHighSpeed ? 'text-indigo-600' : 'text-slate-400'
                      }`}
                    />
                    <span className="text-xs font-bold text-slate-600">
                      高速モード
                    </span>
                    <div
                      className={`ml-auto w-8 h-4 rounded-full relative transition-colors ${
                        isHighSpeed ? 'bg-indigo-600' : 'bg-slate-300'
                      }`}
                    >
                      <div
                        className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                          isHighSpeed ? 'left-4.5' : 'left-0.5'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-2 border-t border-slate-100">
                <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                {!isProcessing ? (
                  <button
                    onClick={startCsvProcessing}
                    disabled={files.length === 0}
                    className="flex items-center gap-2 px-6 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-bold rounded-lg shadow-sm transition-colors"
                  >
                    <Play className="w-4 h-4" /> 開始
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      stopRef.current = true;
                      setIsProcessing(false);
                    }}
                    className="flex items-center gap-2 px-6 py-2 bg-amber-500 text-white font-bold rounded-lg shadow-sm hover:bg-amber-600 transition-colors"
                  >
                    <Pause className="w-4 h-4" /> 停止
                  </button>
                )}
              </div>
            </div>

            {/* CSV結果リスト */}
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
              <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h2 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                  <CheckCircle className="w-4 h-4" /> 判定結果 ({results.length}
                  件)
                </h2>
                <button
                  onClick={() => downloadCSV(results)}
                  disabled={results.length === 0}
                  className="text-sm text-blue-600 hover:text-blue-800 disabled:text-slate-300 flex items-center gap-1 hover:bg-blue-50 px-3 py-1 rounded transition-colors"
                >
                  <Download className="w-4 h-4" /> CSV保存
                </button>
              </div>
              <div className="overflow-x-auto max-h-[80vh] overflow-y-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-10 shadow-sm">
                    <tr>
                      <th className="px-4 py-3 w-24 bg-slate-50 text-center">
                        リスク
                      </th>
                      <th className="px-4 py-3 bg-slate-50 min-w-[300px]">
                        商品名
                      </th>
                      <th className="px-4 py-3 w-1/3 min-w-[250px] bg-slate-50">
                        理由
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {results.map((item, idx) => (
                      <tr
                        key={idx}
                        className="hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 py-3 text-center align-middle">
                          {getRiskBadge(item.risk)}
                        </td>
                        <td
                          className="px-4 py-3 font-medium text-slate-700 align-middle line-clamp-2"
                          title={item.productName}
                        >
                          {item.productName}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-sm align-middle">
                          {item.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* --- 履歴画面 --- */}
        {activeTab === 'history' && (
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden animate-in fade-in w-full">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center">
              <div>
                <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                  <History className="w-5 h-5 text-blue-600" /> チェック履歴
                  (最新50件)
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  High/Mediumのリスク判定のみクラウドに保存されています。
                </p>
              </div>
              {!db && (
                <span className="text-xs text-red-500 bg-red-50 px-2 py-1 rounded">
                  ※Firebase未設定
                </span>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                  <tr>
                    <th className="px-6 py-3">日時</th>
                    <th className="px-6 py-3">リスク</th>
                    <th className="px-6 py-3">商品名</th>
                    <th className="px-6 py-3">理由</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {historyData.map((item) => (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50 transition-colors"
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-slate-400 text-xs">
                        {item.createdAt
                          ? new Date(
                              item.createdAt.seconds * 1000
                            ).toLocaleString()
                          : '-'}
                      </td>
                      <td className="px-6 py-4">{getRiskBadge(item.risk)}</td>
                      <td className="px-6 py-4 font-medium text-slate-700 max-w-xs truncate">
                        {item.productName}
                      </td>
                      <td className="px-6 py-4 text-slate-600 text-xs">
                        {item.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* --- 設定画面 --- */}
        {activeTab === 'settings' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 w-full animate-in fade-in">
            <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5" /> アプリ設定
            </h2>

            <div className="space-y-4 max-w-2xl">
              <div className="bg-blue-50 p-4 rounded-lg">
                <label className="block text-sm font-bold text-blue-900 mb-1">
                  1. Gemini API Key (必須)
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                  placeholder="AIza..."
                />
              </div>

              <div className="bg-orange-50 p-4 rounded-lg">
                <label className="block text-sm font-bold text-orange-900 mb-1">
                  2. 楽天アプリID (URL検索用)
                </label>
                <input
                  type="text"
                  value={rakutenAppId}
                  onChange={(e) => setRakutenAppId(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-white"
                  placeholder="100... (数字の羅列)"
                />
                <p className="text-xs text-orange-700 mt-1">
                  <a
                    href="https://webservice.rakuten.co.jp/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    楽天Developers
                  </a>{' '}
                  で無料で発行できます。
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  3. Firebase Config (履歴保存用)
                </label>
                <textarea
                  value={firebaseConfigJson}
                  onChange={(e) => setFirebaseConfigJson(e.target.value)}
                  className="w-full px-4 py-2 border rounded-lg bg-slate-50 h-24 text-xs font-mono"
                  placeholder='{"apiKey": "...", ...}'
                />
              </div>

              <div className="pt-4">
                <button
                  onClick={saveSettings}
                  className="flex items-center justify-center gap-2 w-full bg-indigo-600 text-white font-bold py-2 rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  <Save className="w-4 h-4" /> 設定を保存
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
