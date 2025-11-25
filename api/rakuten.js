export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const { shopUrl, appId, page = 1 } = request.query;

  if (!shopUrl || !appId) {
    return response.status(400).json({ error: 'URLと楽天アプリIDが必要です' });
  }

  try {
    // 1. URLからショップコードを抽出（強化版）
    let shopCode = '';
    try {
      // URLエンコードされている可能性を考慮してデコード
      const decodedUrl = decodeURIComponent(shopUrl);
      const urlObj = new URL(decodedUrl);
      
      // パス（/から始まる部分）を取得し、スラッシュで分割
      // クエリパラメータ（?以降）は urlObj.pathname には含まれないので自動的に除外されます
      const pathParts = urlObj.pathname.split('/').filter(p => p && p !== 'gold'); 

      // ホスト名による分岐
      if (urlObj.hostname.includes('rakuten.ne.jp')) {
        // パターン: www.rakuten.ne.jp/gold/SHOP_CODE/
        // filterで 'gold' を除外したので、先頭がショップコードのはず
        if (pathParts.length > 0) {
          shopCode = pathParts[0];
        }
      } else if (urlObj.hostname.includes('rakuten.co.jp')) {
        // パターン: www.rakuten.co.jp/SHOP_CODE/
        // パターン: item.rakuten.co.jp/SHOP_CODE/ITEM_ID/
        
        // 明らかにショップコードではない予約語を除外
        const ignored = ['search', 'category', 'event', 'review'];
        if (pathParts.length > 0 && !ignored.includes(pathParts[0])) {
             shopCode = pathParts[0];
        }
      }
    } catch (e) {
      return response.status(400).json({ error: '無効なショップURL形式です' });
    }

    if (!shopCode) {
      return response.status(400).json({ 
        error: 'ショップIDを特定できませんでした。',
        hint: 'ショップのトップページURL（例: https://www.rakuten.co.jp/shop-name/）を入力してください。'
      });
    }

    // 2. 楽天API呼び出し
    // imageFlag=1: 画像がある商品のみ（通常は全て画像あり）
    const rakutenApiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?format=json&shopCode=${shopCode}&applicationId=${appId}&hits=30&page=${page}&imageFlag=1`;
    
    const res = await fetch(rakutenApiUrl);
    
    if (!res.ok) {
        if (res.status === 429) return response.status(429).json({ error: '楽天API制限超過。少し待ってください。' });
        const text = await res.text();
        return response.status(res.status).json({ error: `楽天APIエラー (${res.status})`, details: text });
    }

    const data = await res.json();

    // APIエラーハンドリング
    if (data.error) {
      // wrong_parameter は「ショップが見つからない」場合によく出る
      if (data.error === 'wrong_parameter') {
        return response.status(200).json({ 
          shopCode, 
          products: [], 
          count: 0, 
          pageCount: 0,
          warning: `ショップID「${shopCode}」で検索しましたがヒットしませんでした。URLを確認してください。`
        });
      }
      return response.status(400).json({ error: `楽天APIエラー: ${data.error_description || data.error}` });
    }

    // 3. データ整形
    const products = data.Items.map(item => {
      const i = item.Item;
      // 画像URLの整形（?以降のパラメータ削除で高画質化）
      let imageUrl = null;
      if (i.mediumImageUrls && i.mediumImageUrls.length > 0) {
        imageUrl = i.mediumImageUrls[0].imageUrl.split('?')[0];
      }
      return {
        name: i.itemName,
        price: i.itemPrice,
        url: i.itemUrl,
        imageUrl: imageUrl,
        shopName: i.shopName,
        shopUrl: i.shopUrl
      };
    });

    return response.status(200).json({ 
        shopCode, 
        products,
        count: data.count,
        pageCount: data.pageCount 
    });

  } catch (error) {
    return response.status(500).json({ error: 'サーバー内部エラー', details: error.message });
  }
}