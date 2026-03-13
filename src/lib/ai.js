import { getMenu, createOrder } from './db';

// Extract API keys from env
const openRouterKeys = [];
for (let i = 1; i <= 25; i++) {
  const key = process.env[`api${i}`];
  if (key) {
    openRouterKeys.push(key);
  }
}

export async function callOpenRouter(messages) {
  if (openRouterKeys.length === 0) throw new Error('No API keys');
  
  // Shuffle keys to distribute load and serve as fallback queue
  const keys = [...openRouterKeys].sort(() => 0.5 - Math.random());
  
  for (const apiKey of keys) {
    try {
      const controller = new AbortController();
      // Extremely strict 3.5s latency timeout per key
      const timeoutId = setTimeout(() => controller.abort(), 3500); 
      
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          "model": "openrouter/free",
          "messages": messages
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const data = await response.json();
      if (!response.ok) {
        console.warn(`[OpenRouter] Key failed with ${response.status}. Retrying...`);
        continue;
      }

      if (data.choices && data.choices.length > 0) {
        return data.choices[0].message.content || "{}";
      }
    } catch (err) {
      console.warn(`[OpenRouter] Key timed out or aborted. Retrying next key...`);
      continue;
    }
  }
  
  throw new Error("All OpenRouter API keys failed or timed out.");
}

export async function generateWaiterResponse(userText, conversationHistory = []) {
  // 1. Get Menu from Database
  const storeId = 1;
  const menuItems = await getMenu(storeId);
  const menuText = menuItems.map(m => `- ${m.name} (ID: ${m.id}) - Rp ${m.price}`).join('\n');

  // 2. Build Ultra-Short System Prompt for Low Latency
  const systemPrompt = `Kamu Waiter AI Resto Oyan. Singkat, ramah, gaul (lo/gue).
Jawab SEMUA input dengan JSON VALID. DILARANG ada teks di luar JSON.
FORMAT:
{
"voice_response": "balasan lisan ke pembeli (singkat 1 kalimat)",
"orders_to_checkout": [{"productId": 1, "quantity": 1}],
"is_checkout_confirmed": false
}
rules: 
- orders_to_checkout diisi JIKA DAN HANYA JIKA is_checkout_confirmed=true (user bilang fix pesen sekarang).
Menu:
${menuText}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...conversationHistory,
    { role: 'user', content: userText }
  ];

  // 3. Make the API Call
  let responseText = await callOpenRouter(messages);
  
  // 4. Parse JSON
  let aiData;
  try {
     // sanitize markdown backticks if accidentally added by LLM
     responseText = responseText.replace(/```json/g, '').replace(/```/g, '');
     aiData = JSON.parse(responseText);
  } catch(e) {
     console.error('Failed to parse AI response:', responseText);
     aiData = { voice_response: "Maaf Kak, aku kurang paham nih, boleh diulang?", orders_to_checkout: [], is_checkout_confirmed: false };
  }

  // 5. If Checkout Confirmed, save to PostgreSQL
  if (aiData.is_checkout_confirmed && aiData.orders_to_checkout.length > 0) {
    try {
      const dbResult = await createOrder("Guest", aiData.orders_to_checkout, storeId);
      console.log('Order created successfully in public.Order!', dbResult);
      aiData.voice_response += ` Pesanan atas nomor TRX ${dbResult.transactionCode} udah aku proses ya! Totalnya bakal muncul di layar.`;
    } catch(err) {
      console.error('Error inserting order to DB', err);
      aiData.voice_response += ' Duh, maaf banget tapi sistem nyatet pesanannya lagi agak gangguan nih. Sebentar ya.';
    }
  }

  return aiData;
}
