/**
 * Speech recognition wrapper.
 * Uses Web Speech API where available (Chrome), falls back to
 * MediaRecorder + Gemini audio transcription (iOS Safari, etc).
 */
export class Speech {
  constructor() {
    this.isListening = false;
    this.transcript = '';
    this.pendingChunk = '';
    this.onTranscript = null;    // callback(fullTranscript)
    this.onChunkReady = null;    // callback(chunk) - text chunk for Web Speech
    this.onAudioChunkReady = null; // callback(base64audio) - audio chunk for fallback
    this.onStatusChange = null;  // callback(isListening)
    this.onError = null;         // callback(error)
    this._silenceTimer = null;
    this._chunkInterval = null;
    this._chunkIntervalMs = 15000; // 15 seconds for faster feedback
    this._silenceTimeoutMs = 8000;

    // Web Speech API state
    this._recognition = null;
    this._restartAttempts = 0;
    this._maxRestarts = 10;
    this._intentionallyStopped = false;

    // MediaRecorder fallback state
    this._mediaRecorder = null;
    this._audioStream = null;
    this._recordingChunks = [];

    this._mode = this._detectMode();
  }

  _detectMode() {
    if (window.SpeechRecognition || window.webkitSpeechRecognition) {
      return 'webspeech';
    }
    if (navigator.mediaDevices?.getUserMedia && window.MediaRecorder) {
      return 'recorder';
    }
    return 'none';
  }

  get supported() {
    return this._mode !== 'none';
  }

  get mode() {
    return this._mode;
  }

  async start() {
    if (this.isListening) return true;

    if (this._mode === 'webspeech') {
      return this._startWebSpeech();
    } else if (this._mode === 'recorder') {
      return await this._startRecorder();
    } else {
      this.onError?.('Speech recognition not supported in this browser');
      return false;
    }
  }

  stop() {
    if (this._mode === 'webspeech') {
      this._stopWebSpeech();
    } else if (this._mode === 'recorder') {
      this._stopRecorder();
    }
    this._clearTimers();
    this.isListening = false;
    this.onStatusChange?.(false);
  }

  reset() {
    this.stop();
    this.transcript = '';
    this.pendingChunk = '';
  }

  getTranscript() {
    return this.transcript.trim();
  }

  /**
   * Get the current pending chunk for immediate processing.
   */
  getPendingChunk() {
    return this.pendingChunk.trim();
  }

  /**
   * Force flush the current chunk immediately (for "I need help" button).
   */
  forceFlush() {
    if (this._mode === 'webspeech') {
      this._flushTextChunk();
    } else if (this._mode === 'recorder') {
      // Stop and restart to flush audio
      if (this._mediaRecorder?.state === 'recording') {
        this._mediaRecorder.stop();
      }
    }
  }

  /**
   * Append externally-produced transcript text (used by recorder fallback
   * when the AI module returns transcribed text).
   */
  appendTranscript(text) {
    this.transcript += text + ' ';
    this.onTranscript?.(this.transcript);
  }

  // ---- Web Speech API path ----

  _startWebSpeech() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    this._recognition = new SpeechRecognition();
    this._recognition.continuous = true;
    this._recognition.interimResults = true;
    this._recognition.lang = 'en-US';

    this._recognition.onresult = (event) => {
      this._resetSilenceTimer();
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalText += event.results[i][0].transcript + ' ';
        }
      }

      if (finalText) {
        this.transcript += finalText;
        this.pendingChunk += finalText;
        this.onTranscript?.(this.transcript);
      }
    };

    this._recognition.onerror = (event) => {
      if (event.error === 'no-speech') return;
      if (event.error === 'aborted' && this._intentionallyStopped) return;
      this.onError?.(event.error);
    };

    this._recognition.onend = () => {
      if (!this._intentionallyStopped && this._restartAttempts < this._maxRestarts) {
        this._restartAttempts++;
        try { this._recognition.start(); } catch {
          this.isListening = false;
          this.onStatusChange?.(false);
        }
        return;
      }
      this.isListening = false;
      this.onStatusChange?.(false);
    };

    try {
      this._intentionallyStopped = false;
      this._restartAttempts = 0;
      this._recognition.start();
      this.isListening = true;
      this.onStatusChange?.(true);
      this._startTextChunkInterval();
      this._resetSilenceTimer();
      return true;
    } catch (e) {
      this.onError?.(e.message);
      return false;
    }
  }

  _stopWebSpeech() {
    this._intentionallyStopped = true;
    if (this._recognition) {
      try { this._recognition.stop(); } catch {}
    }
    // Flush remaining text chunk
    if (this.pendingChunk.trim()) {
      this.onChunkReady?.(this.pendingChunk.trim());
      this.pendingChunk = '';
    }
  }

  _resetSilenceTimer() {
    clearTimeout(this._silenceTimer);
    this._silenceTimer = setTimeout(() => {
      this._flushTextChunk();
    }, this._silenceTimeoutMs);
  }

  _startTextChunkInterval() {
    clearInterval(this._chunkInterval);
    this._chunkInterval = setInterval(() => {
      this._flushTextChunk();
    }, this._chunkIntervalMs);
  }

  _flushTextChunk() {
    if (this.pendingChunk.trim()) {
      this.onChunkReady?.(this.pendingChunk.trim());
      this.pendingChunk = '';
    }
  }

  // ---- MediaRecorder fallback path (iOS Safari) ----

  async _startRecorder() {
    try {
      this._audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      this.onError?.('Microphone access denied');
      return false;
    }

    // Determine supported mime type
    const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg']
      .find(t => MediaRecorder.isTypeSupported(t)) || '';

    this._mediaRecorder = new MediaRecorder(this._audioStream, mimeType ? { mimeType } : {});
    this._recordingChunks = [];

    this._mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        this._recordingChunks.push(e.data);
      }
    };

    // Every chunk interval, stop/restart to flush audio and send it
    this._mediaRecorder.onstop = async () => {
      if (this._recordingChunks.length === 0) return;

      const blob = new Blob(this._recordingChunks, { type: this._mediaRecorder.mimeType || 'audio/webm' });
      this._recordingChunks = [];

      // Convert to base64
      const base64 = await this._blobToBase64(blob);
      const mimeUsed = blob.type || 'audio/webm';
      this.onAudioChunkReady?.(base64, mimeUsed);

      // Restart recording if still listening
      if (this.isListening && this._mediaRecorder.state === 'inactive') {
        try { this._mediaRecorder.start(); } catch {}
      }
    };

    this._mediaRecorder.start();
    this.isListening = true;
    this.onStatusChange?.(true);

    // Periodically stop/restart to flush audio chunks
    this._chunkInterval = setInterval(() => {
      if (this._mediaRecorder?.state === 'recording') {
        this._mediaRecorder.stop();
      }
    }, this._chunkIntervalMs);

    return true;
  }

  _stopRecorder() {
    clearInterval(this._chunkInterval);

    if (this._mediaRecorder?.state === 'recording') {
      this._mediaRecorder.stop();
    }

    if (this._audioStream) {
      this._audioStream.getTracks().forEach(t => t.stop());
      this._audioStream = null;
    }
  }

  _blobToBase64(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        // Strip the data:...;base64, prefix
        const base64 = reader.result.split(',')[1] || '';
        resolve(base64);
      };
      reader.readAsDataURL(blob);
    });
  }

  // ---- Shared ----

  _clearTimers() {
    clearTimeout(this._silenceTimer);
    clearInterval(this._chunkInterval);
  }
}
