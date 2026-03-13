"use client";
import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, Loader2, ShoppingCart, Power, Volume2 } from "lucide-react";

export default function Home() {
  const [isRecording, setIsRecording] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recordingStatus, setRecordingStatus] = useState("Tap microphone to order");
  const [history, setHistory] = useState([]);
  const [cartCount, setCartCount] = useState(0);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [currentVolume, setCurrentVolume] = useState(0); // Added volume monitor
  const isLiveModeRef = useRef(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // VAD refs
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const microphoneRef = useRef(null); // Added this to track the microphone source
  const silenceTimerRef = useRef(null);
  const isSpeakingRef = useRef(false);
  const streamRef = useRef(null);
  const SILENCE_THRESHOLD = 40; // Increased significantly for mobile
  const SILENCE_DURATION_MS = 1200; // wait 1.2s to feel much snappier

  const startRecording = async () => {
    try {
      let stream = streamRef.current;
      if (!stream || stream.getAudioTracks().every(v => v.readyState === 'ended')) {
         stream = await navigator.mediaDevices.getUserMedia({ 
           audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } 
         });
         streamRef.current = stream;
      }
      
      let audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state === 'closed') {
         audioContext = new (window.AudioContext || window.webkitAudioContext)();
         audioContextRef.current = audioContext;
      }
      if (audioContext.state === 'suspended') await audioContext.resume();

      if (!analyserRef.current) {
         const analyser = audioContext.createAnalyser();
         analyser.minDecibels = -90;
         analyser.maxDecibels = -10;
         analyser.smoothingTimeConstant = 0.85;
         analyser.fftSize = 256;
         analyserRef.current = analyser;

         // CRAZY HACK FOR SAFARI & CHROME MOBILE:
         // Browsers will pause the audio processing graph if it doesn't eventually output to the speaker.
         // We create a dummy volume node, set it to 0 (muting it), and plug the mic into it and the speaker so the browser is tricked into running the Analyser forever.
         const dummyGain = audioContext.createGain();
         dummyGain.gain.value = 0;
         analyser.connect(dummyGain);
         dummyGain.connect(audioContext.destination);
      }
      
      // ALWAYS reconnect the new stream to the analyser
      if (microphoneRef.current) {
         microphoneRef.current.disconnect();
      }
      const microphone = audioContext.createMediaStreamSource(stream);
      microphone.connect(analyserRef.current);
      microphoneRef.current = microphone;

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
      
      monitorSilence();

    } catch (error) {
      console.error("Mic error:", error);
      setRecordingStatus("Microphone access denied.");
    }
  };

  const monitorSilence = () => {
    if (!analyserRef.current) return;
    
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

       // Update volume UI every few frames
       if (Math.random() < 0.1) setCurrentVolume(Math.round(average));

       requestAnimationFrame(checkVolume);
    };
    
    checkVolume();
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setRecordingStatus("Processing audio...");
      
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      isSpeakingRef.current = false;

      // DO NOT close AudioContext and Mic in Live Mode to keep it warm for mobile
      if (!isLiveModeRef.current) {
         if (audioContextRef.current) {
            audioContextRef.current.close().catch(e=>e);
            audioContextRef.current = null;
         }
         analyserRef.current = null;
         if (microphoneRef.current) {
            microphoneRef.current.disconnect();
            microphoneRef.current = null;
         }
         if (streamRef.current) {
           streamRef.current.getTracks().forEach(t => t.stop());
           streamRef.current = null;
         }
      }
    } else if (!isLiveModeRef.current) {
       // Deep cleanup if not recording and turning off
       if (audioContextRef.current) {
          audioContextRef.current.close().catch(e=>e);
          audioContextRef.current = null;
       }
       analyserRef.current = null;
       if (microphoneRef.current) {
          microphoneRef.current.disconnect();
          microphoneRef.current = null;
       }
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
          setRecordingStatus(chatData.cartUpdated ? "Order completed!" : "Tap to speak again");
          if (isLiveModeRef.current) {
            startRecording(); // Auto resume listening in Live Mode
          }
        };
        audio.play();
      } else {
        setRecordingStatus("Tap microphone to review or add more.");
        if (isLiveModeRef.current) startRecording();
      }
    } catch (err) {
      console.error(err);
      setRecordingStatus("An error occurred.");
      if (isLiveModeRef.current) startRecording();
    }
  };

  const toggleLiveMode = async () => {
    if (isLiveModeRef.current) {
      isLiveModeRef.current = false;
      setIsLiveMode(false);
      stopRecording();
      setRecordingStatus("Live Mode Disabled.");
    } else {
      isLiveModeRef.current = true;
      setIsLiveMode(true);
      setRecordingStatus("Oyan is greeting...");
      
      // EARLY INIT FOR MOBILE GESTURE
      try {
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
           audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContextRef.current.state === 'suspended') await audioContextRef.current.resume();
        
        if (!streamRef.current || streamRef.current.getAudioTracks().every(v => v.readyState === 'ended')) {
           streamRef.current = await navigator.mediaDevices.getUserMedia({ 
             audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } 
           });
        }
      } catch(e) { console.error('Early mic init failed', e); }

      try {
        const res = await fetch("/api/greet");
        const data = await res.json();
        
        if (data.audioBase64) {
          const audio = new Audio("data:audio/mp3;base64," + data.audioBase64);
          setIsPlaying(true);
          audio.onended = () => {
            setIsPlaying(false);
            if (isLiveModeRef.current) {
              setRecordingStatus("Listening...");
              startRecording();
            }
          };
          audio.play();
        } else {
          startRecording();
        }
      } catch (e) {
        startRecording();
      }
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
            {isRecording && (
              <p className="text-neutral-600 text-xs mt-2">
                Vol: {currentVolume} / {SILENCE_THRESHOLD}
              </p>
            )}
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
      <div className="fixed bottom-10 left-0 w-full flex flex-col items-center z-50 px-6 gap-4">
        
        {/* Live Mode Toggle */}
        <motion.button
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={toggleLiveMode}
          className={`px-6 py-3 rounded-full flex items-center justify-center gap-2 text-sm font-bold shadow-xl transition-all border ${
            isLiveMode
              ? 'bg-rose-500/10 border-rose-500/50 text-rose-500 hover:bg-rose-500/20'
              : 'bg-neutral-900 border-neutral-700 text-neutral-400 hover:text-white'
          }`}
        >
          <Power className="w-4 h-4" /> 
          {isLiveMode ? "AKHIRI SHIFT" : "MULAI SHIFT WAITER"}
        </motion.button>

        {!isLiveMode && (
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={recordingStatus.includes("Processing") || recordingStatus.includes("thinking") || isPlaying}
            className={`h-14 w-full max-w-xs rounded-full flex items-center justify-center gap-2 font-semibold shadow-2xl transition-colors ${
              isRecording 
                ? 'bg-rose-500 hover:bg-rose-600 text-white' 
                : isPlaying || recordingStatus.includes("Processing") || recordingStatus.includes("thinking")
                  ? 'bg-neutral-800 text-neutral-500 cursor-not-allowed'
                  : 'bg-white text-neutral-950 hover:bg-neutral-200'
            }`}
          >
            {isRecording ? (
              <>
                <div className="w-2 h-2 rounded-full bg-white animate-pulse" /> Berhenti Merekam
              </>
            ) : (
              <>
                <Mic className="w-5 h-5" /> Push to Speak (Manual)
              </>
            )}
          </motion.button>
        )}
      </div>
    </div>
  );
}
