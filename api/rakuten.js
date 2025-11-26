export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const { shopUrl, appId, page = 1 } = request.query;

  if (!shopUrl || !appId) {
    return response.status(400).json({ error: 'URLと楽天アプリIDが必要です' });
  }

  try {
    // 1. URLからショップコードを抽出（超強化版）
    let shopCode = '';
    try {
      const decodedUrl = decodeURIComponent(shopUrl);
      const urlObj = new URL(decodedUrl);
      const pathParts = urlObj.pathname.split('/').filter(p => p && p !== 'gold'); 

      // A. 通常のショップURL (www.rakuten.co.jp/SHOP_CODE/)
      if (urlObj.hostname.includes('rakuten.co.jp') || urlObj.hostname.includes('rakuten.ne.jp')) {
        // 予約語を除外してIDを探す
        const ignored = ['search', 'category', 'event', 'review', 'gold'];
        
        // パスから探す
        for (const part of pathParts) {
          if (!ignored.includes(part) && !part.startsWith('item')) {
            shopCode = part;
            break;
          }
        }
        
        // B. 商品ページ (item.rakuten.co.jp/SHOP_CODE/ITEM_ID/)
        if (urlObj.hostname.includes('item.rakuten.co.jp')) {
           if (pathParts.length > 0) shopCode = pathParts[0];
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
    const rakutenApiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?format=json&shopCode=${shopCode}&applicationId=${appId}&hits=30&page=${page}&imageFlag=1`;
    
    const res = await fetch(rakutenApiUrl);
    
    if (!res.ok) {
        if (res.status === 429) return response.status(429).json({ error: '楽天API制限超過。少し待ってください。' });
        const text = await res.text();
        return response.status(res.status).json({ error: `楽天APIエラー (${res.status})`, details: text });
    }

    const data = await res.json();

    if (data.error) {
      if (data.error === 'wrong_parameter') {
        return response.status(200).json({ 
          shopCode, products: [], count: 0, pageCount: 0,
          warning: `ショップID「${shopCode}」が見つかりません。URLを確認してください。`
        });
      }
      return response.status(400).json({ error: `楽天APIエラー: ${data.error_description || data.error}` });
    }

    // 3. データ整形
    const products = data.Items.map(item => {
      const i = item.Item;
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