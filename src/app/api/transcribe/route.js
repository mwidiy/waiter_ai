// The API key we have in .env is "deepgram_apikey"
const apiKey = process.env.deepgram_apikey;

export async function POST(req) {
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Deepgram API Key is missing" }), { status: 500 });
  }
  
  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile) {
      return new Response(JSON.stringify({ error: "No audio file uploaded" }), { status: 400 });
    }

    const buffer = Buffer.from(await audioFile.arrayBuffer());

    // Send to deepgram via native fetch instead of buggy SDK
    const response = await fetch("https://api.deepgram.com/v1/listen?model=nova-2&language=id&smart_format=true", {
      method: "POST",
      headers: {
         "Authorization": `Token ${apiKey}`,
         "Content-Type": audioFile.type || "audio/webm"
      },
      body: buffer
    });

    if (!response.ok) {
       const text = await response.text();
       console.error("Deepgram API Error:", text);
       return new Response(JSON.stringify({ error: `Deepgram API failed: ${response.statusText}` }), { status: 500 });
    }
    
    const result = await response.json();

    const transcript = result?.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
    
    return new Response(JSON.stringify({ transcript }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error("Transcription API Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}
