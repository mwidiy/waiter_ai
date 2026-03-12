require('dotenv').config({ path: '.env.local' });
const { ElevenLabsClient } = require('elevenlabs');

async function testTTS() {
  const elevenLabs = new ElevenLabsClient({ apiKey: process.env.eleventlabs_apikey });
  try {
    const audioStream = await elevenLabs.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
      text: "Testing suara",
      model_id: "eleven_multilingual_v2",
      output_format: "mp3_44100_128",
    });
    console.log("Success streaming audio!");
  } catch (err) {
    console.error("ElevenLabs error:", err);
  }
}

testTTS();
