import { getMenu, createOrder } from './db';

// Extract API keys from env
const openRouterKeys = [];
for (let i = 1; i <= 25; i++) {
  const key = process.env[`api${i}`];
  if (key) {
    openRouterKeys.push(key);
  }
}

function getRandomKey() {
  if (openRouterKeys.length === 0) throw new Error('No OpenRouter API keys found');
  const randomIndex = Math.floor(Math.random() * openRouterKeys.length);
  return openRouterKeys[randomIndex];
}

export async function callOpenRouter(messages) {
  const apiKey = getRandomKey();
  
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      "model": "openrouter/free", // robust free model picker
      "messages": messages
    })
  });

  const data = await response.json();
  if (!response.ok) {
    const errorMsg = data.error ? data.error.message : response.statusText;
    throw new Error(`OpenRouter HTTP ${response.status}: ${errorMsg}`);
  }

  if (data.choices && data.choices.length > 0) {
    return data.choices[0].message.content || "{}";
  }
  return "{}";
}

export async function generateWaiterResponse(userText, conversationHistory = []) {
  // 1. Get Menu from Database
  const storeId = 1;
  const menuItems = await getMenu(storeId);
  const menuText = menuItems.map(m => `- ${m.name} (ID: ${m.id}) - Rp ${m.price}`).join('\n');

  // 2. Build System Prompt for JSON structured output
  const systemPrompt = `Kamu adalah kasir/waiter AI yang ramah, asik, berkaliber profesional, dan memposisikan dirimu sebagai teman dari pembeli restoran "Oyan".
Bicaralah dengan bahasa Indonesia kasual yang natural, gaul tapi sopan (pakai kata lo/gue atau Kak/Mas/Mbak). 

Tugasmu:
1. Melayani pertanyaan seputar menu.
2. Menerima pesanan dari pelanggan.
3. JIKA pelanggan sudah mengkonfirmasi pesanan dan ingin selesai/membayar/checkout, kamu HARUS mengekstrak pesanan mereka ke dalam output JSON.

Berikut adalah daftar menu yang tersedia:
${menuText}

ATURAN OUTPUT:
Kamu HARUS merespons HANYA dalam format JSON valid (tanpa markdown backticks). Skema JSON-nya adalah:
{
  "voice_response": "teks balasan kamu ke pembeli yang akan dibacakan oleh voice AI (natural, ramah, dan asik)",
  "orders_to_checkout": [
    {
      "productId": 13,
      "quantity": 2,
      "priceSnapshot": 15000,
      "note": "catatan khusus jika ada"
    }
  ],
  "is_checkout_confirmed": boolean
}

Catatan:
- "voice_response" adalah apa yang kamu katakan secara vokal ke user.
- "orders_to_checkout" diisi dengan array object produk JIKA dan HANYA JIKA "is_checkout_confirmed" adalah true (user bilang pesanan sudah lengkap dan mau dibikin bonnya/pesan sekarang).
- Gunakan productId yang sesuai dari menu.
- Jika user belum selesai pesan (masih nanya "ada apa aja?", "tambahin Mangg dong"), isi orders_to_checkout dengan [] dan is_checkout_confirmed dengan false.`;

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
