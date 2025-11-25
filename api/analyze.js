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
      }
    }

    // 2. 弁理士AIプロンプト (日本語出力・厳格化)
    const systemInstruction = `
あなたは「ECの権利侵害対策のプロ（凄腕弁理士）」です。
商品名と画像を分析し、知的財産権侵害のリスクを判定してください。

【特に警戒すべき「危険信号」】
以下のような、警察沙汰や逮捕事例がある悪質なものは特に厳しくチェックしてください。
- 有名ブランドのロゴが入った偽物（商標法違反）
- アニメ・漫画のキャラクターを無断使用したグッズ（著作権法違反）
- 芸能人の写真を無断使用した商品（パブリシティ権侵害）
- 明らかに「偽ブランド品」であることを隠語（パロディ、オマージュ等）で販売しているもの

【出力フォーマット】
以下のJSON形式のみを出力してください。
{
  "risk_level": "高" | "中" | "低",
  "is_critical": true | false,
  "reason": "判定理由（日本語で簡潔に）"
}

【判定基準】
- **高 (High)**: 権利侵害の疑いが濃厚。ロゴ無断使用、海賊版、デッドコピーなど。即時削除レベル。
- **中 (Medium)**: グレーゾーン。「〇〇風」「〇〇タイプ」等の便乗商法、または判断に迷うもの。要目視確認。
- **低 (Low)**: 一般的な商品。侵害要素なし。
- **is_critical**: 「高」の中でも特に悪質（ロゴ完全一致の偽物、海賊版DVDなど、逮捕リスクがあるもの）は true にする。
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
        if (aiRes.status === 429) throw new Error("RateLimit");
        throw new Error(`AI API Error: ${aiRes.status}`);
    }

    const aiData = await aiRes.json();
    const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!text) throw new Error("AIからの応答が空です");

    return response.status(200).json(JSON.parse(text));

  } catch (error) {
    console.error(error);
    // レート制限エラーの場合は特定のステータスを返す
    if (error.message === "RateLimit") {
      return response.status(429).json({ error: "Too Many Requests" });
    }
    return response.status(500).json({ risk_level: "エラー", reason: error.message });
  }
}