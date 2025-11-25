export default async function handler(request, response) {
    if (request.method !== 'POST') {
      return response.status(405).json({ error: 'Method Not Allowed' });
    }
  
    const { productName, imageUrl, apiKey } = request.body;
  
    if (!productName || !apiKey) {
      return response.status(400).json({ error: '必要な情報が不足しています' });
    }
  
    try {
      // 1. 画像データの取得とBase64化
      let imagePart = null;
      if (imageUrl) {
        try {
          const imgRes = await fetch(imageUrl);
          const arrayBuffer = await imgRes.arrayBuffer();
          const base64Image = Buffer.from(arrayBuffer).toString('base64');
          const mimeType = imgRes.headers.get('content-type') || 'image/jpeg';
          
          imagePart = {
            inlineData: {
              data: base64Image,
              mimeType: mimeType
            }
          };
        } catch (e) {
          console.warn("画像取得失敗:", e);
          // 画像が取れなくてもテキストだけで判定続行
        }
      }
  
      // 2. 超一流弁理士プロンプト
      const systemInstruction = `
  あなたは知的財産権を専門とする「超一流の弁理士」かつ「ECパトロールのプロ」です。
  提供された「商品名」と「商品画像」を照らし合わせ、権利侵害のリスクを厳格に判定してください。
  
  【判定ロジック】
  1. **商標権・不正競争防止法**:
     - 画像に有名ブランドのロゴや特徴的な柄（モノグラム等）があるのに、商品名で「〇〇風」「ノーブランド」等と謳っていないか？
     - 逆に、商品名でブランドを謳っているが、画像が明らかに粗悪なコピー品ではないか？
  2. **意匠権**:
     - 画像の商品形状が、有名なデザイナーズ家具や家電等の「デッドコピー」ではないか？
  3. **著作権**:
     - 画像にアニメキャラ、芸能人の写真、公式の宣材写真が無断使用されている疑いはないか？
  
  【リスクレベル定義】
  - **High**: 侵害の疑いが極めて強い。即時停止推奨。（例: ロゴ入り偽物、海賊版、明白なデッドコピー）
  - **Medium**: グレーゾーン。確認が必要。（例: 「〇〇対応」「〇〇タイプ」等の表現、パロディ商品）
  - **Low**: 一般的な商品。権利侵害の要素が見当たらない。
  
  【出力形式】
  以下のJSON形式のみを出力してください。余計な挨拶は不要です。
  {"risk_level": "High"|"Medium"|"Low", "reason": "専門家としての簡潔な指摘（日本語）"}
  `;
  
      // 3. Gemini APIへ送信
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${apiKey}`;
      
      const contentsParts = [{ text: `商品名: ${productName}` }];
      if (imagePart) {
        contentsParts.push(imagePart);
      }
  
      const payload = {
        contents: [{ role: "user", parts: contentsParts }],
        systemInstruction: { parts: [{ text: systemInstruction }] },
        generationConfig: { responseMimeType: "application/json" }
      };
  
      const aiRes = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
  
      if (!aiRes.ok) {
          const errText = await aiRes.text();
          throw new Error(`AI API Error: ${aiRes.status} ${errText}`);
      }
  
      const aiData = await aiRes.json();
      const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!text) throw new Error("AIからの応答が空です");
  
      return response.status(200).json(JSON.parse(text));
  
    } catch (error) {
      console.error(error);
      return response.status(500).json({ risk_level: "Error", reason: error.message });
    }
  }