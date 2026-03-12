import { generateWaiterResponse } from '@/lib/ai';
import { ElevenLabsClient } from 'elevenlabs';

// Initialize ElevenLabs
const elevenLabs = process.env.eleventlabs_apikey ? new ElevenLabsClient({
  apiKey: process.env.eleventlabs_apikey,
}) : null;

export async function POST(req) {
  try {
    const { text, history } = await req.json();

    if (!text) {
      return new Response(JSON.stringify({ error: 'Text query is required' }), { status: 400 });
    }

    // 1. Send To LLM & Save to DB if Checkout Confirmed
    const aiResponseData = await generateWaiterResponse(text, history || []);
    const { voice_response, orders_to_checkout, is_checkout_confirmed } = aiResponseData;

    // 2. Synthesize with ElevenLabs
    let audioBase64 = null;
    if (elevenLabs && voice_response) {
      try {
        const audioStream = await elevenLabs.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb", {
          text: voice_response,
          model_id: "eleven_multilingual_v2",
          output_format: "mp3_44100_128",
        });

        // Convert stream to buffer
        const chunks = [];
        for await (const chunk of audioStream) {
          chunks.push(chunk);
        }
        const audioBuffer = Buffer.concat(chunks);
        audioBase64 = audioBuffer.toString('base64');
      } catch (err) {
        console.error('ElevenLabs synthesis failed.');
        if (err.body) {
           const chunks = [];
           for await (const chunk of err.body) chunks.push(chunk);
           console.error('API Error:', Buffer.concat(chunks).toString('utf-8'));
        } else {
           console.error(err.message);
        }
      }
    }

    return new Response(JSON.stringify({
      text: voice_response,
      audioBase64,
      cartUpdated: is_checkout_confirmed && orders_to_checkout && orders_to_checkout.length > 0,
      timestamp: Date.now()
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
