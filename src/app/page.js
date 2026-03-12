"use client";
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Loader2, ShoppingCart, MessageCircle, MoreHorizontal } from "lucide-react";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("Tap microphone to order");
  const [history, setHistory] = useState([]);
  const [cartCount, setCartCount] = useState(0);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // VAD refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const streamRef = useRef(null);
  const SILENCE_THRESHOLD = 15; // adjust threshold (0-255) based on room noise
  const SILENCE_DURATION_MS = 2000; // wait 2s of silence before stopping

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Setup VAD
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      
      analyser.minDecibels = -90;
      analyser.maxDecibels = -10;
      analyser.smoothingTimeConstant = 0.85;
      analyser.fftSize = 256;
      microphone.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        await processAudio(audioBlob);
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      setRecordingStatus("Listening... (Auto-stops when you finish speaking)");
      
      // Start checking volume
      monitorSilence();

    } catch (error) {
      console.error("Mic error:", error);
      setRecordingStatus("Microphone access denied.");
    }
  };

  const monitorSilence = () => {
    if (!analyserRef.current || !isRecording) return;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    const checkVolume = () => {
       if (mediaRecorderRef.current?.state !== 'recording') return;

       analyserRef.current.getByteFrequencyData(dataArray);
       
       // Calculate average volume
       let sum = 0;
       for(let i = 0; i < bufferLength; i++) {
         sum += dataArray[i];
       }
       const average = sum / bufferLength;

       if (average > SILENCE_THRESHOLD) {
          // User is speaking
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
          isSpeakingRef.current = true;
       } else {
          // Silence detected
          if (isSpeakingRef.current && !silenceTimerRef.current) {
             // Start silence timer
             silenceTimerRef.current = setTimeout(() => {
                if (mediaRecorderRef.current?.state === 'recording') {
                   stopRecording();
                }
             }, SILENCE_DURATION_MS);
          }
       }

       requestAnimationFrame(checkVolume);
    };
    
    checkVolume();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingStatus("Processing audio...");
      
      // Cleanup VAD
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (audioContextRef.current) {
         audioContextRef.current.close();
         audioContextRef.current = null;
      }
      isSpeakingRef.current = false;

      // Stop mic tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    }
  };

  const processAudio = async (blob) => {
    try {
      // 1. STT with Deepgram
      const formData = new FormData();
      formData.append("audio", blob, "audio.webm");

      const sttRes = await fetch("/api/transcribe", { method: "POST", body: formData });
      const { transcript } = await sttRes.json();
      
      if (!transcript) {
        setRecordingStatus("Didn't catch that. Please try again.");
        return;
      }

      const updatedHistory = [...history, { role: "user", content: transcript }];
      setHistory(updatedHistory);
      setRecordingStatus("AI is thinking...");

      // 2. Chat with AI
      const chatRes = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript, history: history })
      });
      
      const chatData = await chatRes.json();

      if (chatData.error) throw new Error(chatData.error);

      setHistory([...updatedHistory, { role: "assistant", content: chatData.text }]);
      setRecordingStatus("AI is speaking...");

      if (chatData.cartUpdated) {
        setCartCount(prev => prev + 1);
        setRecordingStatus("Order confirmed & added to cart!");
      }

      // 3. Play TTS
      if (chatData.audioBase64) {
        const audio = new Audio("data:audio/mp3;base64," + chatData.audioBase64);
        setIsPlaying(true);
        audio.onended = () => {
          setIsPlaying(false);
          setRecordingStatus(chatData.cartUpdated ? "Order completed! Tap to order again." : "Tap to speak again");
          // Optionally, auto-restart recording here if you want it completely hands-free:
          // startRecording();
        };
        audio.play();
      } else {
        setRecordingStatus("Tap microphone to review or add more.");
      }
    } catch (err) {
      console.error(err);
      setRecordingStatus("An error occurred.");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-white flex flex-col font-sans selection:bg-rose-500/30">
      {/* Header */}
      <header className="flex items-center justify-between p-6 w-full max-w-5xl mx-auto">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-rose-500 to-orange-500 flex items-center justify-center font-bold text-sm">
            O
          </div>
          <h1 className="text-xl font-bold tracking-tight">Oyan Resto AI</h1>
        </div>
        <div className="relative p-2 bg-neutral-900 rounded-full border border-neutral-800">
          <ShoppingCart className="w-5 h-5 text-neutral-300" />
          {cartCount > 0 && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-500 text-[10px] font-bold">
              {cartCount}
            </span>
          )}
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-6 w-full max-w-lg mx-auto relative mt-[-40px]">
        {/* Visualizer area */}
        <div className="flex-1 flex flex-col justify-center items-center w-full my-8 min-h-[250px] relative">
          
          {/* Pulsing rings when playing or recording */}
          {(isPlaying || isRecording) && (
            <>
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: [1, 1.5, 2], opacity: [0.3, 0.1, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                className="absolute w-32 h-32 rounded-full bg-rose-500/20"
              />
              <motion.div 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: [1, 1.3, 1.8], opacity: [0.3, 0.1, 0] }}
                transition={{ duration: 2, delay: 0.5, repeat: Infinity, ease: "easeOut" }}
                className="absolute w-32 h-32 rounded-full bg-orange-500/20"
              />
            </>
          )}

          {/* AI Status / Avatar */}
          <motion.div 
            animate={{ 
              scale: isPlaying || isRecording ? [1, 1.05, 1] : 1,
            }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="z-10 w-32 h-32 rounded-full bg-neutral-900 border border-neutral-800 shadow-2xl flex items-center justify-center overflow-hidden"
          >
            {isPlaying ? (
              <div className="flex gap-1 items-center">
                {[1,2,3,4].map((i) => (
                  <motion.div
                    key={i}
                    animate={{ height: ["10%", "80%", "30%"] }}
                    transition={{ duration: 0.4 + (i*0.1), repeat: Infinity, repeatType: "mirror" }}
                    className="w-1.5 bg-rose-500 rounded-full"
                    style={{ height: '20%' }}
                  />
                ))}
              </div>
            ) : isRecording ? (
              <div className="flex items-center gap-1.5 text-rose-500">
                <Mic className="w-8 h-8 animate-pulse" />
              </div>
            ) : recordingStatus.includes("Processing") || recordingStatus.includes("thinking") ? (
              <Loader2 className="w-8 h-8 animate-spin text-neutral-400" />
            ) : (
              <div className="text-4xl">🧑‍🍳</div>
            )}
          </motion.div>
          
          <div className="mt-8 text-center">
            <p className="text-neutral-400 font-medium text-sm tracking-widest uppercase">
              {recordingStatus}
            </p>
          </div>
        </div>

        {/* Conversation Snippet */}
        {history.length > 0 && (
          <div className="w-full bg-neutral-900/50 backdrop-blur-md rounded-3xl p-6 border border-neutral-800/50 mb-12 shadow-xl">
            {history.slice(-2).map((msg, i) => (
              <div key={i} className={`mb-3 last:mb-0 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                <span className={`inline-block px-4 py-2 rounded-2xl text-sm ${msg.role === 'user' ? 'bg-neutral-800 text-neutral-200' : 'bg-rose-500/10 border border-rose-500/20 text-rose-100'}`}>
                  {msg.content}
                </span>
              </div>
            ))}
          </div>
        )}

      </main>

      {/* Mic Button Fixed Bottom */}
      <div className="fixed bottom-10 left-0 w-full flex justify-center z-50 px-6">
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={isRecording ? stopRecording : startRecording}
          disabled={recordingStatus.includes("Processing") || recordingStatus.includes("thinking") || isPlaying}
          className={`h-16 w-full max-w-xs rounded-full flex items-center justify-center gap-2 text-lg font-semibold shadow-2xl transition-colors ${
            isRecording 
              ? 'bg-rose-500 hover:bg-rose-600 text-white' 
              : isPlaying || recordingStatus.includes("Processing") || recordingStatus.includes("thinking")
                ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                : 'bg-white text-neutral-950 hover:bg-neutral-200'
          }`}
        >
          {isRecording ? (
            <>
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" /> Stop Recording
            </>
          ) : (
            <>
              <Mic className="w-5 h-5" /> Push to Speak
            </>
          )}
        </motion.button>
      </div>
    </div>
  );
}
