import { AI } from './ai.js';
import { Speech } from './speech.js';
import { $, showScreen, toast, formatTime, renderSessionItem, renderQuestionItem } from './ui.js';

class App {
  constructor() {
    this.ai = new AI();
    this.speech = new Speech();
    this.mode = 'lesson'; // 'lesson' | 'talk'
    this.currentEntry = null;
    this.prepOutline = null;
    this.lessonPlan = [];
    this.currentPointIndex = 0;
    this.talkSections = [];
    this.currentSectionIndex = 0;
    this.timerSeconds = 0;
    this.timerInterval = null;
    this.suggestionHideTimer = null;
    this.isLive = false;
  }

  init() {
    this.bindRouting();
    this.bindTabBar();
    this.navigate(location.hash || '#lessons');
  }

  // --- localStorage CRUD ---

  loadHistory(key) {
    try {
      return JSON.parse(localStorage.getItem(key)) || [];
    } catch {
      return [];
    }
  }

  saveHistory(key, list) {
    // Cap at 20 entries, trim oldest
    const trimmed = list.slice(0, 20);
    localStorage.setItem(key, JSON.stringify(trimmed));
  }

  saveCurrentSession() {
    if (!this.currentEntry) return;

    const transcript = this.speech.getTranscript();
    const duration = this.timerSeconds;

    if (this.mode === 'lesson') {
      const lessons = this.loadHistory('lc_lessons');
      const existing = lessons.findIndex(l => l.id === this.currentEntry.id);
      const entry = {
        ...this.currentEntry,
        transcript,
        duration,
        updatedAt: new Date().toISOString()
      };
      if (existing >= 0) {
        lessons[existing] = entry;
      } else {
        lessons.unshift(entry);
      }
      this.saveHistory('lc_lessons', lessons);
    } else {
      const talks = this.loadHistory('lc_talks');
      const existing = talks.findIndex(t => t.id === this.currentEntry.id);
      const entry = {
        ...this.currentEntry,
        transcript,
        duration,
        updatedAt: new Date().toISOString()
      };
      if (existing >= 0) {
        talks[existing] = entry;
      } else {
        talks.unshift(entry);
      }
      this.saveHistory('lc_talks', talks);
    }
  }

  // --- Routing ---

  bindRouting() {
    window.addEventListener('hashchange', () => {
      this.navigate(location.hash);
    });
  }

  bindTabBar() {
    const tabBar = $('#tab-bar');
    if (!tabBar) return;
    tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      const tab = btn.dataset.tab;
      location.hash = `#${tab}`;
    });
  }

  updateTabBar(route) {
    const tabBar = $('#tab-bar');
    if (!tabBar) return;

    // Hide tab bar during live/prep/summary screens
    const hideOn = ['lesson-prep', 'lesson-live', 'lesson-summary', 'talk-prep', 'talk-live', 'talk-summary', 'settings'];
    if (hideOn.includes(route)) {
      tabBar.classList.add('hidden');
    } else {
      tabBar.classList.remove('hidden');
    }

    // Highlight active tab
    tabBar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === route);
    });
  }

  navigate(hash) {
    const route = hash.replace('#', '') || 'lessons';

    // If leaving live, clean up
    if (this.isLive && route !== 'lesson-live' && route !== 'talk-live') {
      this.stopLive();
    }

    this.updateTabBar(route);

    switch (route) {
      case 'settings': this.renderSettings(); break;
      case 'lessons': this.mode = 'lesson'; this.renderLessonsTab(); break;
      case 'talks': this.mode = 'talk'; this.renderTalksTab(); break;
      case 'lesson-prep': this.mode = 'lesson'; this.renderLessonPrep(); break;
      case 'lesson-live': this.mode = 'lesson'; this.renderLessonLive(); break;
      case 'lesson-summary': this.mode = 'lesson'; this.renderSummary(); break;
      case 'talk-prep': this.mode = 'talk'; this.renderTalkPrep(); break;
      case 'talk-live': this.mode = 'talk'; this.renderTalkLive(); break;
      case 'talk-summary': this.mode = 'talk'; this.renderSummary(); break;
      default: this.mode = 'lesson'; this.renderLessonsTab();
    }
  }

  // --- Settings ---

  renderSettings() {
    const hasKey = this.ai.hasApiKey();
    const key = this.ai.getApiKey();

    $('#screen-settings').innerHTML = `
      <div class="header">
        <button class="header-btn back-btn" onclick="location.hash='#${this.mode === 'talk' ? 'talks' : 'lessons'}'"></button>
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
          <p>Lesson Companion helps you prepare and deliver lessons and talks
          with AI-powered assistance.</p>
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

  // --- Lessons Tab ---

  renderLessonsTab() {
    const lessons = this.loadHistory('lc_lessons');

    let html = `
      <div class="header">
        <div style="width:40px"></div>
        <h1>Lessons</h1>
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

    html += `
      <button class="new-session-btn" id="new-lesson-btn">+ New Lesson</button>
    `;

    if (lessons.length > 0) {
      html += '<div class="label">Past Lessons</div><ul class="session-list" id="lesson-list"></ul>';
    } else {
      html += `
        <div class="empty-state">
          <div class="icon">&#128218;</div>
          <p>No lessons yet. Tap "New Lesson" to get started.</p>
        </div>
      `;
    }

    html += '</div>';

    $('#screen-lessons').innerHTML = html;
    showScreen('screen-lessons');

    // New lesson button
    $('#new-lesson-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        title: '',
        content: '',
        outline: null,
        plan: [],
        transcript: '',
        duration: 0,
        summary: null,
        notes: '',
        createdAt: new Date().toISOString()
      };
      location.hash = '#lesson-prep';
    });

    // Render past lessons
    if (lessons.length > 0) {
      const list = $('#lesson-list');
      for (const lesson of lessons) {
        list.appendChild(renderSessionItem(lesson, 'lesson', (l) => {
          this.currentEntry = { ...l };
          location.hash = '#lesson-prep';
        }));
      }
    }
  }

  // --- Talks Tab ---

  renderTalksTab() {
    const talks = this.loadHistory('lc_talks');

    let html = `
      <div class="header">
        <div style="width:40px"></div>
        <h1>Talks</h1>
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

    html += `
      <button class="new-session-btn" id="new-talk-btn">+ New Talk</button>
    `;

    if (talks.length > 0) {
      html += '<div class="label">Past Talks</div><ul class="session-list" id="talk-list"></ul>';
    } else {
      html += `
        <div class="empty-state">
          <div class="icon">&#127908;</div>
          <p>No talks yet. Tap "New Talk" to get started.</p>
        </div>
      `;
    }

    html += '</div>';

    $('#screen-talks').innerHTML = html;
    showScreen('screen-talks');

    // New talk button
    $('#new-talk-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        topic: '',
        scriptures: '',
        content: '',
        outline: null,
        transcript: '',
        duration: 0,
        summary: null,
        notes: '',
        createdAt: new Date().toISOString()
      };
      location.hash = '#talk-prep';
    });

    // Render past talks
    if (talks.length > 0) {
      const list = $('#talk-list');
      for (const talk of talks) {
        list.appendChild(renderSessionItem(talk, 'talk', (t) => {
          this.currentEntry = { ...t };
          location.hash = '#talk-prep';
        }));
      }
    }
  }

  // --- Lesson Prep ---

  renderLessonPrep() {
    if (!this.currentEntry) {
      location.hash = '#lessons';
      return;
    }

    const entry = this.currentEntry;

    $('#screen-lesson-prep').innerHTML = `
      <div class="header">
        <button class="header-btn back-btn" onclick="location.hash='#lessons'"></button>
        <h1>Prepare Lesson</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto" class="no-tab-padding">
        <div class="entry-form">
          <div class="input-group">
            <label for="lesson-title-input">Talk / Conference Session Title</label>
            <input type="text" id="lesson-title-input" placeholder="e.g. 'Faith in Uncertain Times'"
              value="${entry.title || ''}">
          </div>
          <div class="input-group">
            <label for="lesson-content-input">Content / Notes / Key Points</label>
            <textarea id="lesson-content-input" placeholder="Paste the talk content, your notes, or key scriptures and themes you want to discuss...">${entry.content || ''}</textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="generate-lesson-outline-btn"
            ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            Generate Discussion Questions
          </button>
          ${!this.ai.hasApiKey() ? '<p class="hint mt-1">Add API key in Settings to enable AI.</p>' : ''}
        </div>

        <div class="prep-section" id="ai-outline-section" style="display:none">
          <h3>AI Discussion Outline</h3>
          <div id="ai-outline-content"></div>
        </div>

        <div class="prep-section" id="questions-section" style="display:none">
          <h3>Discussion Questions</h3>
          <ul class="question-list" id="prep-questions"></ul>
          <button class="add-question-btn mt-1" id="add-question-btn">+ Add Question</button>
        </div>

        <button class="btn btn-primary btn-block btn-lg mt-3" id="start-lesson-btn" style="display:none">
          Start Lesson
        </button>
      </div>
    `;

    showScreen('screen-lesson-prep');

    // If entry already has an outline, render it
    if (entry.outline) {
      this.prepOutline = entry.outline;
      this.renderAIOutline(entry.outline);
      $('#ai-outline-section').style.display = '';
    }

    // If entry already has a plan, render questions
    if (entry.plan?.length) {
      this.renderPrepQuestions(entry.plan);
      $('#questions-section').style.display = '';
      $('#start-lesson-btn').style.display = '';
    }

    // Generate outline
    $('#generate-lesson-outline-btn').addEventListener('click', async () => {
      const title = $('#lesson-title-input').value.trim();
      const content = $('#lesson-content-input').value.trim();

      if (!title) {
        toast('Please enter a title');
        return;
      }

      // Save to entry
      this.currentEntry.title = title;
      this.currentEntry.content = content;

      const btn = $('#generate-lesson-outline-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      $('#ai-outline-section').style.display = '';
      $('#ai-outline-content').innerHTML = '<div class="ai-loading"><div class="spinner"></div> Generating outline...</div>';

      try {
        const outline = await this.ai.generateLessonOutline(title, content);
        this.prepOutline = outline;
        this.currentEntry.outline = outline;
        this.renderAIOutline(outline);

        // Auto-populate questions
        if (outline.questions?.length) {
          this.renderPrepQuestions(outline.questions);
          $('#questions-section').style.display = '';
          $('#start-lesson-btn').style.display = '';
        }
      } catch (e) {
        $('#ai-outline-content').innerHTML = `
          <p style="color:var(--danger);font-size:0.875rem">${e.message}</p>
        `;
      }

      btn.disabled = false;
      btn.textContent = 'Generate Discussion Questions';
    });

    // Add question
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
      // Save title/content from inputs
      this.currentEntry.title = $('#lesson-title-input').value.trim() || this.currentEntry.title;
      this.currentEntry.content = $('#lesson-content-input').value.trim() || this.currentEntry.content;
      this.lessonPlan = this.getVisibleQuestions();
      this.currentEntry.plan = this.lessonPlan;
      this.currentPointIndex = 0;
      location.hash = '#lesson-live';
    });
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

    $('#use-ai-questions-btn')?.addEventListener('click', () => {
      this.renderPrepQuestions(outline.questions);
      $('#questions-section').style.display = '';
      $('#start-lesson-btn').style.display = '';
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

  // --- Talk Prep ---

  renderTalkPrep() {
    if (!this.currentEntry) {
      location.hash = '#talks';
      return;
    }

    const entry = this.currentEntry;

    $('#screen-talk-prep').innerHTML = `
      <div class="header">
        <button class="header-btn back-btn" onclick="location.hash='#talks'"></button>
        <h1>Prepare Talk</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto" class="no-tab-padding">
        <div class="entry-form">
          <div class="input-group">
            <label for="talk-topic-input">Topic</label>
            <input type="text" id="talk-topic-input" placeholder="e.g. 'The Power of Prayer'"
              value="${entry.topic || ''}">
          </div>
          <div class="input-group">
            <label for="talk-scriptures-input">Scriptures to Include</label>
            <input type="text" id="talk-scriptures-input" placeholder="e.g. 'Alma 37:37, D&C 19:38'"
              value="${entry.scriptures || ''}">
          </div>
          <div class="input-group">
            <label for="talk-content-input">Talk Content / Draft</label>
            <textarea id="talk-content-input" rows="10" placeholder="Write your talk here, or enter rough notes and let AI help you outline it...">${entry.content || ''}</textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="generate-talk-outline-btn"
            ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            AI Outline Help
          </button>
          ${!this.ai.hasApiKey() ? '<p class="hint mt-1">Add API key in Settings to enable AI.</p>' : ''}
        </div>

        <div class="prep-section" id="talk-outline-section" style="display:none">
          <h3>AI Talk Outline</h3>
          <div id="talk-outline-content"></div>
        </div>

        <button class="btn btn-primary btn-block btn-lg mt-3" id="start-talk-btn">
          Start Delivery
        </button>
      </div>
    `;

    showScreen('screen-talk-prep');

    // If entry already has an outline, render it
    if (entry.outline) {
      this.renderTalkOutline(entry.outline);
      $('#talk-outline-section').style.display = '';
    }

    // Generate outline
    $('#generate-talk-outline-btn').addEventListener('click', async () => {
      const topic = $('#talk-topic-input').value.trim();
      const scriptures = $('#talk-scriptures-input').value.trim();
      const content = $('#talk-content-input').value.trim();

      if (!topic) {
        toast('Please enter a topic');
        return;
      }

      this.currentEntry.topic = topic;
      this.currentEntry.scriptures = scriptures;
      this.currentEntry.content = content;

      const btn = $('#generate-talk-outline-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      $('#talk-outline-section').style.display = '';
      $('#talk-outline-content').innerHTML = '<div class="ai-loading"><div class="spinner"></div> Generating outline...</div>';

      try {
        const outline = await this.ai.generateTalkOutline(topic, scriptures, content);
        this.currentEntry.outline = outline;
        this.renderTalkOutline(outline);
      } catch (e) {
        $('#talk-outline-content').innerHTML = `
          <p style="color:var(--danger);font-size:0.875rem">${e.message}</p>
        `;
      }

      btn.disabled = false;
      btn.textContent = 'AI Outline Help';
    });

    // Start delivery
    $('#start-talk-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || this.currentEntry.topic;
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim() || this.currentEntry.scriptures;
      this.currentEntry.content = $('#talk-content-input').value.trim() || this.currentEntry.content;

      if (!this.currentEntry.topic && !this.currentEntry.content) {
        toast('Please enter a topic or content');
        return;
      }

      // Build sections for teleprompter
      this.buildTalkSections();
      location.hash = '#talk-live';
    });
  }

  renderTalkOutline(outline) {
    const el = $('#talk-outline-content');
    if (!el) return;

    let html = '';

    if (outline.sections?.length) {
      outline.sections.forEach((s, i) => {
        html += `
          <div class="card mb-2">
            <div class="label">${s.heading} (~${s.estimatedMinutes} min)</div>
            <p style="white-space:pre-wrap">${s.content}</p>
          </div>
        `;
      });

      html += `<div class="card mb-2">
        <div class="label">Total estimated time</div>
        <p style="font-weight:600;color:var(--gold)">${outline.totalMinutes} minutes</p>
      </div>`;

      html += `<button class="btn btn-secondary btn-block mt-1" id="use-talk-outline-btn">
        Use This Outline as Talk Content
      </button>`;
    }

    if (outline.tips?.length) {
      html += '<div class="label mt-2">Tips</div><div class="card">';
      outline.tips.forEach(t => {
        html += `<p style="margin-bottom:4px;color:var(--text-primary)">&bull; ${t}</p>`;
      });
      html += '</div>';
    }

    el.innerHTML = html;

    $('#use-talk-outline-btn')?.addEventListener('click', () => {
      // Merge outline sections into content textarea
      const contentText = outline.sections.map(s => `${s.heading}\n\n${s.content}`).join('\n\n---\n\n');
      $('#talk-content-input').value = contentText;
      this.currentEntry.content = contentText;
      toast('Outline added to content');
    });
  }

  buildTalkSections() {
    const content = this.currentEntry.content || this.currentEntry.topic;
    // Split by double newline or --- separator
    const raw = content.split(/\n{2,}|---/).map(s => s.trim()).filter(s => s.length > 0);
    this.talkSections = raw.length > 0 ? raw : [content];
    this.currentSectionIndex = 0;
  }

  // --- Lesson Live ---

  renderLessonLive() {
    if (!this.currentEntry || this.lessonPlan.length === 0) {
      location.hash = '#lesson-prep';
      return;
    }

    this.isLive = true;
    this.timerSeconds = 0;
    this.currentPointIndex = 0;

    const point = this.lessonPlan[this.currentPointIndex];

    $('#screen-lesson-live').innerHTML = `
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

    showScreen('screen-lesson-live');
    this.startLiveCommon('lesson');
  }

  advancePoint() {
    if (this.currentPointIndex < this.lessonPlan.length - 1) {
      this.currentPointIndex++;
      const point = this.lessonPlan[this.currentPointIndex];
      const el = $('#current-point');
      const progress = $('#point-progress');
      if (el) el.textContent = point.question;
      if (progress) progress.textContent = `${this.currentPointIndex + 1} of ${this.lessonPlan.length}`;

      const crossRef = el?.nextElementSibling;
      if (crossRef && crossRef.classList.contains('text-muted')) {
        crossRef.textContent = point.cross_reference || '';
      }
    } else {
      const el = $('#tap-hint');
      if (el) el.textContent = 'Last point reached. Tap "End" when done.';
    }
  }

  // --- Talk Live (Teleprompter) ---

  renderTalkLive() {
    if (!this.currentEntry || this.talkSections.length === 0) {
      location.hash = '#talk-prep';
      return;
    }

    this.isLive = true;
    this.timerSeconds = 0;
    this.currentSectionIndex = 0;

    let sectionsHtml = '';
    this.talkSections.forEach((text, i) => {
      const state = i === 0 ? 'active' : 'upcoming';
      sectionsHtml += `<div class="teleprompter-section ${state}" data-section="${i}">${text}</div>`;
    });

    $('#screen-talk-live').innerHTML = `
      <div class="live-screen">
        <div class="live-top-bar">
          <div class="timer" id="live-timer">00:00</div>
          <div class="mic-status">
            <span class="mic-dot" id="mic-dot"></span>
            <span id="mic-label">Mic off</span>
          </div>
          <button class="stop-btn" id="stop-lesson-btn">End</button>
        </div>

        <div class="teleprompter" id="teleprompter-area">
          <div class="teleprompter-progress" id="teleprompter-progress">
            Section 1 of ${this.talkSections.length}
          </div>
          ${sectionsHtml}
        </div>

        <div class="suggestion-bar" id="suggestion-bar">
          <button class="suggestion-dismiss" id="dismiss-suggestion">&times;</button>
          <div class="suggestion-label" id="suggestion-type">Delivery Tip</div>
          <div class="suggestion-text" id="suggestion-text"></div>
        </div>
      </div>
    `;

    showScreen('screen-talk-live');

    // Tap to advance section
    $('#teleprompter-area').addEventListener('click', () => {
      this.advanceSection();
    });

    this.startLiveCommon('talk');
  }

  advanceSection() {
    if (this.currentSectionIndex < this.talkSections.length - 1) {
      // Mark current as past
      const current = document.querySelector(`.teleprompter-section[data-section="${this.currentSectionIndex}"]`);
      if (current) {
        current.classList.remove('active');
        current.classList.add('past');
      }

      this.currentSectionIndex++;

      // Mark new as active
      const next = document.querySelector(`.teleprompter-section[data-section="${this.currentSectionIndex}"]`);
      if (next) {
        next.classList.remove('upcoming');
        next.classList.add('active');
        next.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      const progress = $('#teleprompter-progress');
      if (progress) progress.textContent = `Section ${this.currentSectionIndex + 1} of ${this.talkSections.length}`;
    }
  }

  // --- Shared Live Logic ---

  startLiveCommon(mode) {
    // Timer
    this.timerInterval = setInterval(() => {
      this.timerSeconds++;
      const el = $('#live-timer');
      if (el) el.textContent = formatTime(this.timerSeconds);
    }, 1000);

    // Tap to advance (lesson mode only — talk has its own handler)
    if (mode === 'lesson') {
      $('#live-main-area').addEventListener('click', (e) => {
        if (e.target.closest('.transcript-preview')) return;
        this.advancePoint();
      });
    }

    // Stop button
    $('#stop-lesson-btn').addEventListener('click', () => {
      this.saveCurrentSession();
      this.stopLive();
      location.hash = mode === 'lesson' ? '#lesson-summary' : '#talk-summary';
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
        const display = text.length > 200 ? '...' + text.slice(-200) : text;
        el.textContent = display;
      }
    };

    // Web Speech path: text chunks
    this.speech.onChunkReady = async (chunk) => {
      if (!this.ai.hasApiKey() || !this.isLive) return;
      try {
        let suggestion;
        if (mode === 'lesson') {
          suggestion = await this.ai.generateLiveSuggestion(
            chunk,
            this.currentEntry,
            this.lessonPlan[this.currentPointIndex]?.question || ''
          );
        } else {
          suggestion = await this.ai.generateTalkDeliverySuggestion(
            chunk,
            this.currentEntry.content || this.currentEntry.topic,
            this.talkSections[this.currentSectionIndex] || ''
          );
        }
        this.showSuggestion(suggestion);
      } catch (e) {
        console.error('Live suggestion error:', e);
      }
    };

    // MediaRecorder fallback path
    this.speech.onAudioChunkReady = async (base64Audio, mimeType) => {
      if (!this.ai.hasApiKey() || !this.isLive) return;
      try {
        const currentPoint = mode === 'lesson'
          ? (this.lessonPlan[this.currentPointIndex]?.question || '')
          : (this.talkSections[this.currentSectionIndex] || '');

        const result = await this.ai.transcribeAndSuggest(
          base64Audio,
          mimeType,
          this.currentEntry,
          currentPoint,
          mode
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

  showSuggestion(suggestion) {
    const bar = $('#suggestion-bar');
    const typeEl = $('#suggestion-type');
    const textEl = $('#suggestion-text');
    if (!bar || !typeEl || !textEl) return;

    const typeLabels = {
      question: 'Follow-up Question',
      scripture: 'Scripture Reference',
      redirect: 'Discussion Redirect',
      pacing: 'Pacing',
      transition: 'Transition',
      emphasis: 'Emphasis',
      encouragement: 'Encouragement'
    };

    typeEl.textContent = typeLabels[suggestion.type] || 'AI Suggestion';
    textEl.textContent = suggestion.suggestion + (suggestion.detail ? ` (${suggestion.detail})` : '');

    bar.classList.add('visible');

    clearTimeout(this.suggestionHideTimer);
    this.suggestionHideTimer = setTimeout(() => this.hideSuggestion(), 15000);
  }

  hideSuggestion() {
    clearTimeout(this.suggestionHideTimer);
    const bar = $('#suggestion-bar');
    if (bar) bar.classList.remove('visible');
  }

  stopLive() {
    this.isLive = false;
    clearInterval(this.timerInterval);
    this.speech.stop();
    this.hideSuggestion();
  }

  // --- Summary (mode-aware) ---

  async renderSummary() {
    if (!this.currentEntry) {
      location.hash = this.mode === 'lesson' ? '#lessons' : '#talks';
      return;
    }

    const screenId = this.mode === 'lesson' ? 'screen-lesson-summary' : 'screen-talk-summary';
    const backHash = this.mode === 'lesson' ? '#lessons' : '#talks';
    const durationMin = Math.floor(this.timerSeconds / 60);
    const transcript = this.speech.getTranscript();
    const title = this.mode === 'lesson' ? this.currentEntry.title : this.currentEntry.topic;

    if (this.mode === 'lesson') {
      const coveredCount = Math.min(this.currentPointIndex + 1, this.lessonPlan.length);
      const totalCount = this.lessonPlan.length;

      $(`#${screenId}`).innerHTML = `
        <div class="header">
          <div style="width:40px"></div>
          <h1>Summary</h1>
          <div style="width:40px"></div>
        </div>
        <div style="padding:16px;flex:1;overflow-y:auto">
          <div class="summary-header">
            <h2>${title}</h2>
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
            <textarea id="summary-notes" placeholder="Add any personal notes about this lesson...">${this.currentEntry.notes || ''}</textarea>
          </div>

          <div class="summary-actions mt-2">
            <button class="btn btn-secondary" id="save-notes-btn">Save Notes</button>
            <button class="btn btn-primary" id="done-btn">Done</button>
          </div>
        </div>
      `;

      showScreen(screenId);

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

      // AI summary
      if (this.ai.hasApiKey() && transcript) {
        try {
          const summary = await this.ai.generateLessonSummary(
            title, transcript, coveredCount, totalCount, durationMin
          );
          this.currentEntry.summary = summary;
          this.renderLessonAISummary(summary);
        } catch (e) {
          $('#ai-summary-content').innerHTML = `
            <p style="color:var(--danger);font-size:0.875rem">${e.message}</p>
          `;
        }
      }
    } else {
      // Talk summary
      $(`#${screenId}`).innerHTML = `
        <div class="header">
          <div style="width:40px"></div>
          <h1>Talk Summary</h1>
          <div style="width:40px"></div>
        </div>
        <div style="padding:16px;flex:1;overflow-y:auto">
          <div class="summary-header">
            <h2>${title}</h2>
            <div class="summary-stat">
              <div class="stat">
                <div class="stat-value">${durationMin}</div>
                <div class="stat-label">Minutes</div>
              </div>
              <div class="stat">
                <div class="stat-value">${this.currentSectionIndex + 1}/${this.talkSections.length}</div>
                <div class="stat-label">Sections</div>
              </div>
            </div>
          </div>

          <div class="prep-section" id="ai-summary-section">
            <h3>Delivery Feedback</h3>
            <div id="ai-summary-content">
              ${(this.ai.hasApiKey() && transcript)
                ? '<div class="ai-loading"><div class="spinner"></div> Analyzing delivery...</div>'
                : '<p class="text-muted">No transcript available for feedback.</p>'}
            </div>
          </div>

          <div class="summary-notes">
            <h3>Notes</h3>
            <textarea id="summary-notes" placeholder="Add any notes about this talk...">${this.currentEntry.notes || ''}</textarea>
          </div>

          <div class="summary-actions mt-2">
            <button class="btn btn-secondary" id="save-notes-btn">Save Notes</button>
            <button class="btn btn-primary" id="done-btn">Done</button>
          </div>
        </div>
      `;

      showScreen(screenId);

      // AI talk summary
      if (this.ai.hasApiKey() && transcript) {
        try {
          const summary = await this.ai.generateTalkSummary(title, transcript, durationMin);
          this.currentEntry.summary = summary;
          this.renderTalkAISummary(summary);
        } catch (e) {
          $('#ai-summary-content').innerHTML = `
            <p style="color:var(--danger);font-size:0.875rem">${e.message}</p>
          `;
        }
      }
    }

    // Save notes (shared)
    $('#save-notes-btn').addEventListener('click', () => {
      const notes = $('#summary-notes').value;
      this.currentEntry.notes = notes;
      this.saveCurrentSession();
      toast('Notes saved');
    });

    // Done
    $('#done-btn').addEventListener('click', () => {
      this.speech.reset();
      location.hash = backHash;
    });
  }

  renderLessonAISummary(summary) {
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

  renderTalkAISummary(summary) {
    const el = $('#ai-summary-content');
    if (!el) return;

    let html = '';

    if (summary.assessment) {
      html += `<div class="card mb-2">
        <div class="label">Overall</div>
        <p>${summary.assessment}</p>
      </div>`;
    }

    if (summary.strengths?.length) {
      html += '<div class="card mb-2">';
      html += '<div class="label">Strengths</div>';
      summary.strengths.forEach(s => {
        html += `<p style="margin-bottom:4px;color:var(--success)">&bull; ${s}</p>`;
      });
      html += '</div>';
    }

    if (summary.improvements?.length) {
      html += '<div class="card mb-2">';
      html += '<div class="label">Areas to Improve</div>';
      summary.improvements.forEach(s => {
        html += `<p style="margin-bottom:4px;color:var(--warning)">&bull; ${s}</p>`;
      });
      html += '</div>';
    }

    if (summary.encouragement) {
      html += `<div class="card">
        <p style="color:var(--gold);font-style:italic">${summary.encouragement}</p>
      </div>`;
    }

    el.innerHTML = html || '<p class="text-muted">No feedback generated.</p>';
  }
}

// Boot
const app = new App();
app.init();
