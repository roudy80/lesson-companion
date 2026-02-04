import { AI } from './ai.js';
import { Speech } from './speech.js';
import { $, showScreen, toast, formatTime, getCurrentWeek, renderLessonItem, renderQuestionItem } from './ui.js';

class App {
  constructor() {
    this.ai = new AI();
    this.speech = new Speech();
    this.lessons = [];
    this.selectedLesson = null;
    this.prepOutline = null;    // { opening, questions, themes }
    this.lessonPlan = [];       // merged questions for live lesson
    this.currentPointIndex = 0;
    this.timerSeconds = 0;
    this.timerInterval = null;
    this.suggestionHideTimer = null;
    this.isLive = false;
  }

  async init() {
    await this.loadLessons();
    this.bindRouting();
    this.navigate(location.hash || '#home');
  }

  async loadLessons() {
    try {
      const res = await fetch('./data/lessons.json');
      const data = await res.json();
      this.lessons = data.lessons || [];
    } catch (e) {
      console.error('Failed to load lessons:', e);
      this.lessons = [];
    }
  }

  // --- Routing ---

  bindRouting() {
    window.addEventListener('hashchange', () => {
      this.navigate(location.hash);
    });
  }

  navigate(hash) {
    const route = hash.replace('#', '') || 'home';

    // If leaving live lesson, clean up
    if (this.isLive && route !== 'live') {
      this.stopLiveLesson();
    }

    switch (route) {
      case 'settings': this.renderSettings(); break;
      case 'home': this.renderHome(); break;
      case 'prep': this.renderPrep(); break;
      case 'live': this.renderLive(); break;
      case 'summary': this.renderSummary(); break;
      default: this.renderHome();
    }
  }

  // --- Settings ---

  renderSettings() {
    const hasKey = this.ai.hasApiKey();
    const key = this.ai.getApiKey();

    $('#screen-settings').innerHTML = `
      <div class="header">
        <button class="header-btn back-btn" onclick="location.hash='#home'"></button>
        <h1>Settings</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px">
        <div class="settings-section">
          <h3>Google Gemini API Key</h3>
          <div class="input-group">
            <label for="api-key-input">API Key</label>
            <input type="password" id="api-key-input" placeholder="Enter your Gemini API key"
              value="${hasKey ? key : ''}">
            <p class="hint">
              Free tier available.
              <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Get a key here</a>
            </p>
          </div>
          <div id="key-status">
            ${hasKey
              ? '<span class="key-status valid">&#10003; Key saved</span>'
              : '<span class="key-status missing">&#10007; No key set</span>'}
          </div>
          <div class="mt-2" style="display:flex;gap:12px">
            <button class="btn btn-primary" id="save-key-btn">Save Key</button>
            <button class="btn btn-ghost" id="test-key-btn" ${!hasKey ? 'disabled' : ''}>Test Key</button>
          </div>
        </div>

        <div class="settings-section">
          <h3>About</h3>
          <p>Lesson Companion helps you prepare and teach Elders Quorum lessons
          using Come, Follow Me curriculum with AI-powered assistance.</p>
          <p class="mt-1 text-muted" style="font-size:0.8125rem">
            Your API key is stored only in your browser's local storage
            and is only sent to Google's Gemini API.
          </p>
        </div>
      </div>
    `;

    showScreen('screen-settings');

    $('#save-key-btn').addEventListener('click', () => {
      const val = $('#api-key-input').value.trim();
      if (!val) {
        toast('Please enter an API key');
        return;
      }
      localStorage.setItem('gemini_api_key', val);
      $('#key-status').innerHTML = '<span class="key-status valid">&#10003; Key saved</span>';
      $('#test-key-btn').disabled = false;
      toast('API key saved');
    });

    $('#test-key-btn').addEventListener('click', async () => {
      const btn = $('#test-key-btn');
      btn.disabled = true;
      btn.textContent = 'Testing...';
      const valid = await this.ai.validateKey(this.ai.getApiKey());
      btn.disabled = false;
      btn.textContent = 'Test Key';
      if (valid) {
        $('#key-status').innerHTML = '<span class="key-status valid">&#10003; Key valid</span>';
        toast('API key is working');
      } else {
        $('#key-status').innerHTML = '<span class="key-status missing">&#10007; Key invalid</span>';
        toast('API key is invalid or network error');
      }
    });
  }

  // --- Home ---

  renderHome() {
    const currentLesson = getCurrentWeek(this.lessons);

    let html = `
      <div class="header">
        <div style="width:40px"></div>
        <h1>Lesson Companion</h1>
        <button class="header-btn settings-btn" onclick="location.hash='#settings'"></button>
      </div>
      <div style="padding:16px">
    `;

    if (!this.ai.hasApiKey()) {
      html += `
        <div class="card mb-2" style="border-color:var(--warning)">
          <p style="color:var(--warning);font-weight:600;margin-bottom:4px">Setup Required</p>
          <p style="font-size:0.875rem">Add your free Gemini API key in
            <a href="#settings" style="color:var(--gold)">Settings</a> to enable AI features.</p>
        </div>
      `;
    }

    if (currentLesson) {
      html += `
        <div class="current-week">
          <div class="label">This Week</div>
          <h2>${currentLesson.title}</h2>
          <div class="scripture-ref">${currentLesson.scripture_block}</div>
          <button class="btn btn-primary btn-block" id="prep-current-btn">
            Prepare Lesson
          </button>
        </div>
      `;
    }

    html += `<div class="label mt-2">All Lessons</div><ul class="lesson-list" id="lesson-list"></ul></div>`;

    $('#screen-home').innerHTML = html;
    showScreen('screen-home');

    // Render lesson list
    const list = $('#lesson-list');
    for (const lesson of this.lessons) {
      const isCurrent = currentLesson && lesson.week === currentLesson.week;
      list.appendChild(renderLessonItem(lesson, isCurrent, (l) => {
        this.selectedLesson = l;
        location.hash = '#prep';
      }));
    }

    // Prep current button
    if (currentLesson) {
      $('#prep-current-btn')?.addEventListener('click', () => {
        this.selectedLesson = currentLesson;
        location.hash = '#prep';
      });
    }
  }

  // --- Prep ---

  async renderPrep() {
    if (!this.selectedLesson) {
      location.hash = '#home';
      return;
    }

    const lesson = this.selectedLesson;

    $('#screen-prep').innerHTML = `
      <div class="header">
        <button class="header-btn back-btn" onclick="location.hash='#home'"></button>
        <h1>Prepare</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto">
        <div class="prep-header">
          <div class="scripture-ref">${lesson.scripture_block}</div>
          <h2>${lesson.title}</h2>
          <p class="text-muted">${lesson.date_range}</p>
        </div>

        <div class="prep-section">
          <h3>Key Topics</h3>
          <ul style="padding-left:18px;color:var(--text-secondary)">
            ${lesson.topics.map(t => `<li style="margin-bottom:4px">${t}</li>`).join('')}
          </ul>
        </div>

        <div class="prep-section" id="ai-outline-section">
          <h3>AI Discussion Outline</h3>
          <div id="ai-outline-content">
            ${this.ai.hasApiKey()
              ? '<div class="ai-loading"><div class="spinner"></div> Generating outline...</div>'
              : '<p class="text-muted">Add your API key in Settings to generate an AI outline.</p>'}
          </div>
        </div>

        <div class="prep-section">
          <h3>Suggested Questions</h3>
          <ul class="question-list" id="prep-questions"></ul>
          <button class="add-question-btn mt-1" id="add-question-btn">+ Add Question</button>
        </div>

        <button class="btn btn-primary btn-block btn-lg mt-3" id="start-lesson-btn">
          Start Lesson
        </button>
      </div>
    `;

    showScreen('screen-prep');

    // Render default suggested questions
    this.renderPrepQuestions(lesson.suggested_questions.map(q => ({ question: q, cross_reference: '' })));

    // Add question button
    $('#add-question-btn').addEventListener('click', () => {
      const text = prompt('Enter your question:');
      if (text?.trim()) {
        const qList = this.getVisibleQuestions();
        qList.push({ question: text.trim(), cross_reference: '' });
        this.renderPrepQuestions(qList);
      }
    });

    // Start lesson
    $('#start-lesson-btn').addEventListener('click', () => {
      this.lessonPlan = this.getVisibleQuestions();
      this.currentPointIndex = 0;
      location.hash = '#live';
    });

    // Generate AI outline
    if (this.ai.hasApiKey()) {
      try {
        const outline = await this.ai.generatePrepOutline(lesson);
        this.prepOutline = outline;
        this.renderAIOutline(outline);
      } catch (e) {
        $('#ai-outline-content').innerHTML = `
          <p style="color:var(--danger);font-size:0.875rem">${e.message}</p>
        `;
      }
    }
  }

  renderAIOutline(outline) {
    const el = $('#ai-outline-content');
    if (!el) return;

    let html = '';

    if (outline.opening) {
      html += `<div class="card mb-2"><p>${outline.opening}</p></div>`;
    }

    if (outline.questions?.length) {
      html += '<div class="label mt-2">AI-Generated Questions</div>';
      html += '<ul class="question-list">';
      outline.questions.forEach(q => {
        html += `
          <li class="question-item">
            <div class="question-text">${q.question}</div>
            ${q.cross_reference ? `<div class="cross-ref">${q.cross_reference}</div>` : ''}
          </li>
        `;
      });
      html += '</ul>';
      html += `<button class="btn btn-secondary btn-block mt-1" id="use-ai-questions-btn">
        Use These Questions
      </button>`;
    }

    if (outline.themes?.length) {
      html += '<div class="label mt-2">Key Themes</div>';
      html += '<div class="card">';
      outline.themes.forEach(t => {
        html += `<p style="margin-bottom:4px;color:var(--text-primary)">&bull; ${t}</p>`;
      });
      html += '</div>';
    }

    el.innerHTML = html;

    // "Use these questions" replaces the prep question list
    $('#use-ai-questions-btn')?.addEventListener('click', () => {
      this.renderPrepQuestions(outline.questions);
      toast('Questions updated');
    });
  }

  renderPrepQuestions(questions) {
    const list = $('#prep-questions');
    if (!list) return;
    list.innerHTML = '';
    questions.forEach((q, i) => {
      list.appendChild(renderQuestionItem(q, i));
    });
  }

  getVisibleQuestions() {
    const items = document.querySelectorAll('#prep-questions .question-item');
    return Array.from(items).map(item => ({
      question: item.querySelector('.question-text')?.textContent?.trim() || '',
      cross_reference: item.querySelector('.cross-ref')?.textContent?.trim() || ''
    }));
  }

  // --- Live Lesson ---

  renderLive() {
    if (!this.selectedLesson || this.lessonPlan.length === 0) {
      location.hash = '#prep';
      return;
    }

    this.isLive = true;
    this.timerSeconds = 0;
    this.currentPointIndex = 0;

    const point = this.lessonPlan[this.currentPointIndex];

    $('#screen-live').innerHTML = `
      <div class="live-screen">
        <div class="live-top-bar">
          <div class="timer" id="live-timer">00:00</div>
          <div class="mic-status">
            <span class="mic-dot" id="mic-dot"></span>
            <span id="mic-label">Mic off</span>
          </div>
          <button class="stop-btn" id="stop-lesson-btn">End</button>
        </div>

        <div class="live-main" id="live-main-area">
          <div class="point-progress" id="point-progress">
            ${this.currentPointIndex + 1} of ${this.lessonPlan.length}
          </div>
          <div class="current-point" id="current-point">${point.question}</div>
          ${point.cross_reference ? `<p class="text-muted" style="font-size:0.875rem">${point.cross_reference}</p>` : ''}
          <div class="tap-hint mt-2" id="tap-hint">Tap anywhere to advance</div>

          <div class="transcript-preview" id="transcript-box">
            <div class="transcript-label">Live Transcript${this.speech.mode === 'recorder' ? ' (via Gemini)' : ''}</div>
            <div id="transcript-text">${this.speech.mode === 'recorder' ? 'Recording audio...' : 'Listening...'}</div>
          </div>
        </div>

        <div class="suggestion-bar" id="suggestion-bar">
          <button class="suggestion-dismiss" id="dismiss-suggestion">&times;</button>
          <div class="suggestion-label" id="suggestion-type">AI Suggestion</div>
          <div class="suggestion-text" id="suggestion-text"></div>
        </div>
      </div>
    `;

    showScreen('screen-live');

    // Timer
    this.timerInterval = setInterval(() => {
      this.timerSeconds++;
      const el = $('#live-timer');
      if (el) el.textContent = formatTime(this.timerSeconds);
    }, 1000);

    // Tap to advance
    $('#live-main-area').addEventListener('click', (e) => {
      if (e.target.closest('.transcript-preview')) return;
      this.advancePoint();
    });

    // Stop button
    $('#stop-lesson-btn').addEventListener('click', () => {
      this.stopLiveLesson();
      location.hash = '#summary';
    });

    // Dismiss suggestion
    $('#dismiss-suggestion').addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideSuggestion();
    });

    // Speech
    this.speech.onStatusChange = (listening) => {
      const dot = $('#mic-dot');
      const label = $('#mic-label');
      if (dot) dot.classList.toggle('active', listening);
      if (label) label.textContent = listening ? 'Listening' : 'Mic off';
    };

    this.speech.onTranscript = (text) => {
      const el = $('#transcript-text');
      if (el) {
        // Show last ~200 chars
        const display = text.length > 200 ? '...' + text.slice(-200) : text;
        el.textContent = display;
      }
    };

    // Web Speech path: text chunks
    this.speech.onChunkReady = async (chunk) => {
      if (!this.ai.hasApiKey() || !this.isLive) return;
      try {
        const suggestion = await this.ai.generateLiveSuggestion(
          chunk,
          this.selectedLesson,
          this.lessonPlan[this.currentPointIndex]?.question || ''
        );
        this.showSuggestion(suggestion);
      } catch (e) {
        console.error('Live suggestion error:', e);
      }
    };

    // MediaRecorder fallback path: audio chunks sent to Gemini for transcription + suggestion
    this.speech.onAudioChunkReady = async (base64Audio, mimeType) => {
      if (!this.ai.hasApiKey() || !this.isLive) return;
      try {
        const result = await this.ai.transcribeAndSuggest(
          base64Audio,
          mimeType,
          this.selectedLesson,
          this.lessonPlan[this.currentPointIndex]?.question || ''
        );
        if (result.transcript) {
          this.speech.appendTranscript(result.transcript);
        }
        if (result.suggestion) {
          this.showSuggestion(result);
        }
      } catch (e) {
        console.error('Audio transcription error:', e);
      }
    };

    this.speech.onError = (err) => {
      console.warn('Speech error:', err);
    };

    this.speech.start();
  }

  advancePoint() {
    if (this.currentPointIndex < this.lessonPlan.length - 1) {
      this.currentPointIndex++;
      const point = this.lessonPlan[this.currentPointIndex];
      const el = $('#current-point');
      const progress = $('#point-progress');
      if (el) el.textContent = point.question;
      if (progress) progress.textContent = `${this.currentPointIndex + 1} of ${this.lessonPlan.length}`;

      // Update cross-reference if present
      const crossRef = el?.nextElementSibling;
      if (crossRef && crossRef.classList.contains('text-muted')) {
        crossRef.textContent = point.cross_reference || '';
      }
    } else {
      const el = $('#tap-hint');
      if (el) el.textContent = 'Last point reached. Tap "End" when done.';
    }
  }

  showSuggestion(suggestion) {
    const bar = $('#suggestion-bar');
    const typeEl = $('#suggestion-type');
    const textEl = $('#suggestion-text');
    if (!bar || !typeEl || !textEl) return;

    const typeLabels = {
      question: 'Follow-up Question',
      scripture: 'Scripture Reference',
      redirect: 'Discussion Redirect'
    };

    typeEl.textContent = typeLabels[suggestion.type] || 'AI Suggestion';
    textEl.textContent = suggestion.suggestion + (suggestion.detail ? ` (${suggestion.detail})` : '');

    bar.classList.add('visible');

    // Auto-hide after 15 seconds
    clearTimeout(this.suggestionHideTimer);
    this.suggestionHideTimer = setTimeout(() => this.hideSuggestion(), 15000);
  }

  hideSuggestion() {
    clearTimeout(this.suggestionHideTimer);
    const bar = $('#suggestion-bar');
    if (bar) bar.classList.remove('visible');
  }

  stopLiveLesson() {
    this.isLive = false;
    clearInterval(this.timerInterval);
    this.speech.stop();
    this.hideSuggestion();
  }

  // --- Summary ---

  async renderSummary() {
    if (!this.selectedLesson) {
      location.hash = '#home';
      return;
    }

    const durationMin = Math.floor(this.timerSeconds / 60);
    const coveredCount = Math.min(this.currentPointIndex + 1, this.lessonPlan.length);
    const totalCount = this.lessonPlan.length;
    const transcript = this.speech.getTranscript();

    $('#screen-summary').innerHTML = `
      <div class="header">
        <div style="width:40px"></div>
        <h1>Summary</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto">
        <div class="summary-header">
          <h2>${this.selectedLesson.title}</h2>
          <div class="summary-stat">
            <div class="stat">
              <div class="stat-value">${durationMin}</div>
              <div class="stat-label">Minutes</div>
            </div>
            <div class="stat">
              <div class="stat-value">${coveredCount}/${totalCount}</div>
              <div class="stat-label">Points Covered</div>
            </div>
          </div>
        </div>

        <div class="prep-section">
          <h3>Coverage</h3>
          <ul class="coverage-list" id="coverage-list"></ul>
        </div>

        <div class="prep-section" id="ai-summary-section">
          <h3>AI Summary</h3>
          <div id="ai-summary-content">
            ${(this.ai.hasApiKey() && transcript)
              ? '<div class="ai-loading"><div class="spinner"></div> Generating summary...</div>'
              : '<p class="text-muted">No transcript available for summary.</p>'}
          </div>
        </div>

        <div class="summary-notes">
          <h3>Notes</h3>
          <textarea id="summary-notes" placeholder="Add any personal notes about this lesson..."></textarea>
        </div>

        <div class="summary-actions mt-2">
          <button class="btn btn-secondary" id="save-notes-btn">Save Notes</button>
          <button class="btn btn-primary" id="done-btn">Done</button>
        </div>
      </div>
    `;

    showScreen('screen-summary');

    // Render coverage
    const coverageList = $('#coverage-list');
    this.lessonPlan.forEach((q, i) => {
      const covered = i <= this.currentPointIndex;
      const li = document.createElement('li');
      li.className = 'coverage-item';
      li.innerHTML = `
        <span class="check ${covered ? 'covered' : 'missed'}">${covered ? '&#10003;' : '&#8211;'}</span>
        <span>${q.question}</span>
      `;
      coverageList.appendChild(li);
    });

    // Save notes
    $('#save-notes-btn').addEventListener('click', () => {
      const notes = $('#summary-notes').value;
      if (notes.trim()) {
        const key = `notes_${this.selectedLesson.week}_${Date.now()}`;
        localStorage.setItem(key, JSON.stringify({
          lesson: this.selectedLesson.title,
          week: this.selectedLesson.week,
          date: new Date().toISOString(),
          notes: notes.trim()
        }));
        toast('Notes saved');
      }
    });

    // Done
    $('#done-btn').addEventListener('click', () => {
      this.speech.reset();
      location.hash = '#home';
    });

    // AI summary
    if (this.ai.hasApiKey() && transcript) {
      try {
        const summary = await this.ai.generateSummary(
          this.selectedLesson,
          transcript,
          coveredCount,
          totalCount,
          durationMin
        );
        this.renderAISummary(summary);
      } catch (e) {
        $('#ai-summary-content').innerHTML = `
          <p style="color:var(--danger);font-size:0.875rem">${e.message}</p>
        `;
      }
    }
  }

  renderAISummary(summary) {
    const el = $('#ai-summary-content');
    if (!el) return;

    let html = '';

    if (summary.themes?.length) {
      html += '<div class="card mb-2">';
      html += '<div class="label">Themes Discussed</div>';
      summary.themes.forEach(t => {
        html += `<p style="margin-bottom:4px">&bull; ${t}</p>`;
      });
      html += '</div>';
    }

    if (summary.insights) {
      html += `<div class="card mb-2">
        <div class="label">Key Insights</div>
        <p>${summary.insights}</p>
      </div>`;
    }

    if (summary.followUp?.length) {
      html += '<div class="card">';
      html += '<div class="label">Follow-up for Next Week</div>';
      summary.followUp.forEach(f => {
        html += `<p style="margin-bottom:4px">&bull; ${f}</p>`;
      });
      html += '</div>';
    }

    el.innerHTML = html || '<p class="text-muted">No summary generated.</p>';
  }
}

// Boot
const app = new App();
app.init();
