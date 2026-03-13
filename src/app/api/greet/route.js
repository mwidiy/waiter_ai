import { ElevenLabsClient } from 'elevenlabs';

const elevenLabs = process.env.eleventlabs_apikey ? new ElevenLabsClient({
  apiKey: process.env.eleventlabs_apikey,
}) : null;

export async function GET() {
  try {
    const greetingText = "Halo, selamat datang di Resto Oyan. Apakah ada yang bisa saya bantu?";
    let audioBase64 = null;

    if (elevenLabs) {
      const audioStream = await elevenLabs.textToSpeech.convert(process.env.ELEVENLABS_VOICE_ID || "JBFqnCBsd6RMkjVDRZzb", {
        text: greetingText,
        model_id: "eleven_multilingual_v2",
        output_format: "mp3_44100_128",
      });

      const chunks = [];
      for await (const chunk of audioStream) chunks.push(chunk);
      audioBase64 = Buffer.concat(chunks).toString('base64');
    }

    return new Response(JSON.stringify({
      text: greetingText,
      audioBase64
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Greet API Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
