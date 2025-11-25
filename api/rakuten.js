export default async function handler(request, response) {
  if (request.method !== 'GET') {
    return response.status(405).json({ error: 'Method Not Allowed' });
  }

  const { shopUrl, appId, page = 1 } = request.query;

  if (!shopUrl || !appId) {
    return response.status(400).json({ error: 'URLと楽天アプリIDが必要です' });
  }

  try {
    // 1. URLからショップコードを抽出
    let shopCode = '';
    try {
      const urlObj = new URL(shopUrl);
      const pathParts = urlObj.pathname.split('/').filter(p => p);

      // Gold対応: www.rakuten.ne.jp/gold/SHOP_CODE/
      if (urlObj.hostname === 'www.rakuten.ne.jp' && pathParts[0] === 'gold') {
        shopCode = pathParts[1];
      }
      // 通常: www.rakuten.co.jp/SHOP_CODE/ or item.rakuten.co.jp/SHOP_CODE/ITEM_ID/
      else if (urlObj.hostname === 'www.rakuten.co.jp' || urlObj.hostname === 'item.rakuten.co.jp') {
        shopCode = pathParts[0];
      }
    } catch (e) {
      return response.status(400).json({ error: '無効なショップURL形式です' });
    }

    if (!shopCode) {
      return response.status(400).json({ error: 'ショップURLから店舗IDを特定できませんでした' });
    }

    // 2. 楽天API呼び出し
    const rakutenApiUrl = `https://app.rakuten.co.jp/services/api/IchibaItem/Search/20170706?format=json&shopCode=${shopCode}&applicationId=${appId}&hits=30&page=${page}&imageFlag=1`;
    
    const res = await fetch(rakutenApiUrl);
    
    if (!res.ok) {
        if (res.status === 429) return response.status(429).json({ error: '楽天API制限超過' });
        const text = await res.text();
        return response.status(res.status).json({ error: `楽天APIエラー (${res.status})`, details: text });
    }

    const data = await res.json();

    if (data.error) {
      if (data.error === 'wrong_parameter') return response.status(200).json({ shopCode, products: [], pageCount: 0 });
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
        imageUrl: imageUrl
      };
    });

    return response.status(200).json({ 
        shopCode, 
        products,
        pageCount: data.pageCount 
    });

  } catch (error) {
    return response.status(500).json({ error: 'サーバー内部エラー', details: error.message });
  }
}