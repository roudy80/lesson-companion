import { AI } from './ai.js';
import { Speech } from './speech.js';
import { $, showScreen, toast, formatTime, renderSessionItem } from './ui.js';

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
    this.isLive = false;
    this.hasNoPlan = false;
    this.helpRequested = false;
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

    const hideOn = ['lesson-prep', 'lesson-live', 'lesson-summary', 'talk-prep', 'talk-live', 'talk-summary', 'settings'];
    if (hideOn.includes(route)) {
      tabBar.classList.add('hidden');
    } else {
      tabBar.classList.remove('hidden');
    }

    tabBar.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === route);
    });
  }

  navigate(hash) {
    const route = hash.replace('#', '') || 'lessons';

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
      <button class="quick-start-btn" id="quick-start-lesson-btn">
        <span>&#9889;</span> Start Lesson Now
      </button>
      <button class="new-session-btn" id="new-lesson-btn">+ Plan New Lesson</button>
    `;

    if (lessons.length > 0) {
      html += '<div class="label">Past Lessons</div><ul class="session-list" id="lesson-list"></ul>';
    } else {
      html += `
        <div class="empty-state">
          <div class="icon">&#128218;</div>
          <p>No lessons yet. Start teaching or plan a lesson.</p>
        </div>
      `;
    }

    html += '</div>';

    $('#screen-lessons').innerHTML = html;
    showScreen('screen-lessons');

    // Quick start
    $('#quick-start-lesson-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        title: 'Quick Lesson',
        content: '',
        outline: null,
        plan: [],
        transcript: '',
        duration: 0,
        summary: null,
        notes: '',
        createdAt: new Date().toISOString()
      };
      this.lessonPlan = [];
      this.hasNoPlan = true;
      location.hash = '#lesson-live';
    });

    // Plan new lesson
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
      this.hasNoPlan = false;
      location.hash = '#lesson-prep';
    });

    // Render past lessons
    if (lessons.length > 0) {
      const list = $('#lesson-list');
      for (const lesson of lessons) {
        list.appendChild(renderSessionItem(lesson, 'lesson', (l) => {
          this.currentEntry = { ...l };
          this.hasNoPlan = false;
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
      <button class="quick-start-btn" id="quick-start-talk-btn">
        <span>&#9889;</span> Start Talk Now
      </button>
      <button class="new-session-btn" id="new-talk-btn">+ Plan New Talk</button>
    `;

    if (talks.length > 0) {
      html += '<div class="label">Past Talks</div><ul class="session-list" id="talk-list"></ul>';
    } else {
      html += `
        <div class="empty-state">
          <div class="icon">&#127908;</div>
          <p>No talks yet. Start speaking or plan a talk.</p>
        </div>
      `;
    }

    html += '</div>';

    $('#screen-talks').innerHTML = html;
    showScreen('screen-talks');

    // Quick start
    $('#quick-start-talk-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        topic: 'Quick Talk',
        scriptures: '',
        content: '',
        outline: null,
        transcript: '',
        duration: 0,
        summary: null,
        notes: '',
        createdAt: new Date().toISOString()
      };
      this.talkSections = [];
      this.hasNoPlan = true;
      location.hash = '#talk-live';
    });

    // Plan new talk
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
      this.hasNoPlan = false;
      location.hash = '#talk-prep';
    });

    // Render past talks
    if (talks.length > 0) {
      const list = $('#talk-list');
      for (const talk of talks) {
        list.appendChild(renderSessionItem(talk, 'talk', (t) => {
          this.currentEntry = { ...t };
          this.hasNoPlan = false;
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
        <h1>Plan Lesson</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto" class="no-tab-padding">
        <div class="entry-form">
          <div class="input-group">
            <label for="lesson-title-input">Lesson Title</label>
            <input type="text" id="lesson-title-input" placeholder="e.g. 'Faith in Uncertain Times'"
              value="${entry.title || ''}">
          </div>
          <div class="input-group">
            <label for="lesson-content-input">Content / Notes</label>
            <textarea id="lesson-content-input" placeholder="Paste the talk content, scriptures, themes, or any notes...">${entry.content || ''}</textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="generate-lesson-outline-btn"
            ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            Generate Discussion Questions
          </button>
          ${!this.ai.hasApiKey() ? '<p class="hint mt-1">Add API key in Settings to enable AI.</p>' : ''}
        </div>

        <div class="prep-section" id="ai-outline-section" style="display:none">
          <h3>AI Outline</h3>
          <div id="ai-outline-content"></div>
        </div>

        <div class="prep-section" id="questions-section" style="display:none">
          <h3>Discussion Questions</h3>
          <ul class="question-list" id="prep-questions"></ul>
          <button class="add-question-btn mt-1" id="add-question-btn">+ Add Question</button>
        </div>

        <div class="divider">or</div>

        <button class="btn btn-success btn-block btn-lg" id="start-without-plan-btn">
          Start Without Plan
        </button>

        <button class="btn btn-primary btn-block btn-lg mt-2" id="start-lesson-btn" style="display:none">
          Start With Plan
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

      if (!title && !content) {
        toast('Please enter a title or content');
        return;
      }

      this.currentEntry.title = title || 'Untitled Lesson';
      this.currentEntry.content = content;

      const btn = $('#generate-lesson-outline-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      $('#ai-outline-section').style.display = '';
      $('#ai-outline-content').innerHTML = '<div class="ai-loading"><div class="spinner"></div> Generating...</div>';

      try {
        const outline = await this.ai.generateLessonOutline(title, content);
        this.prepOutline = outline;
        this.currentEntry.outline = outline;
        this.renderAIOutline(outline);

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
        $('#start-lesson-btn').style.display = '';
      }
    });

    // Start without plan
    $('#start-without-plan-btn').addEventListener('click', () => {
      this.currentEntry.title = $('#lesson-title-input').value.trim() || 'Quick Lesson';
      this.currentEntry.content = $('#lesson-content-input').value.trim();
      this.lessonPlan = [];
      this.hasNoPlan = true;
      location.hash = '#lesson-live';
    });

    // Start with plan
    $('#start-lesson-btn').addEventListener('click', () => {
      this.currentEntry.title = $('#lesson-title-input').value.trim() || this.currentEntry.title;
      this.currentEntry.content = $('#lesson-content-input').value.trim() || this.currentEntry.content;
      this.lessonPlan = this.getVisibleQuestions();
      this.currentEntry.plan = this.lessonPlan;
      this.currentPointIndex = 0;
      this.hasNoPlan = false;
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

    if (outline.themes?.length) {
      html += '<div class="card mb-2"><div class="label">Key Themes</div>';
      outline.themes.forEach(t => {
        html += `<p style="margin-bottom:4px;color:var(--text-primary)">&bull; ${t}</p>`;
      });
      html += '</div>';
    }

    el.innerHTML = html || '<p class="text-muted">Outline generated. Questions below.</p>';
  }

  renderPrepQuestions(questions) {
    const list = $('#prep-questions');
    if (!list) return;
    list.innerHTML = '';
    questions.forEach((q, i) => {
      const item = document.createElement('li');
      item.className = 'question-item editable';
      item.innerHTML = `
        <div class="question-text">${q.question}</div>
        ${q.cross_reference ? `<div class="cross-ref">${q.cross_reference}</div>` : ''}
        <div class="question-actions">
          <button class="edit" title="Edit">&#9998;</button>
          <button class="delete" title="Delete">&times;</button>
        </div>
      `;

      // Edit
      item.querySelector('.edit').addEventListener('click', (e) => {
        e.stopPropagation();
        const newText = prompt('Edit question:', q.question);
        if (newText?.trim()) {
          q.question = newText.trim();
          item.querySelector('.question-text').textContent = q.question;
        }
      });

      // Delete
      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        item.remove();
        if (list.children.length === 0) {
          $('#start-lesson-btn').style.display = 'none';
        }
      });

      list.appendChild(item);
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
        <h1>Plan Talk</h1>
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
            <label for="talk-scriptures-input">Scriptures</label>
            <input type="text" id="talk-scriptures-input" placeholder="e.g. 'Alma 37:37, D&C 19:38'"
              value="${entry.scriptures || ''}">
          </div>
          <div class="input-group">
            <label for="talk-content-input">Talk Content</label>
            <textarea id="talk-content-input" rows="10" placeholder="Write your talk or notes...">${entry.content || ''}</textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="generate-talk-outline-btn"
            ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            AI Outline Help
          </button>
          ${!this.ai.hasApiKey() ? '<p class="hint mt-1">Add API key in Settings.</p>' : ''}
        </div>

        <div class="prep-section" id="talk-outline-section" style="display:none">
          <h3>AI Outline</h3>
          <div id="talk-outline-content"></div>
        </div>

        <div class="divider">or</div>

        <button class="btn btn-success btn-block btn-lg" id="start-talk-without-plan-btn">
          Start Without Plan
        </button>

        <button class="btn btn-primary btn-block btn-lg mt-2" id="start-talk-btn">
          Start Delivery
        </button>
      </div>
    `;

    showScreen('screen-talk-prep');

    if (entry.outline) {
      this.renderTalkOutline(entry.outline);
      $('#talk-outline-section').style.display = '';
    }

    // Generate outline
    $('#generate-talk-outline-btn').addEventListener('click', async () => {
      const topic = $('#talk-topic-input').value.trim();
      const scriptures = $('#talk-scriptures-input').value.trim();
      const content = $('#talk-content-input').value.trim();

      if (!topic && !content) {
        toast('Please enter a topic or content');
        return;
      }

      this.currentEntry.topic = topic || 'Untitled Talk';
      this.currentEntry.scriptures = scriptures;
      this.currentEntry.content = content;

      const btn = $('#generate-talk-outline-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      $('#talk-outline-section').style.display = '';
      $('#talk-outline-content').innerHTML = '<div class="ai-loading"><div class="spinner"></div> Generating...</div>';

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

    // Start without plan
    $('#start-talk-without-plan-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || 'Quick Talk';
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim();
      this.currentEntry.content = $('#talk-content-input').value.trim();
      this.talkSections = [];
      this.hasNoPlan = true;
      location.hash = '#talk-live';
    });

    // Start with plan
    $('#start-talk-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || this.currentEntry.topic || 'Talk';
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim();
      this.currentEntry.content = $('#talk-content-input').value.trim();

      this.buildTalkSections();
      this.hasNoPlan = this.talkSections.length === 0;
      location.hash = '#talk-live';
    });
  }

  renderTalkOutline(outline) {
    const el = $('#talk-outline-content');
    if (!el) return;

    let html = '';

    if (outline.sections?.length) {
      outline.sections.forEach((s) => {
        html += `
          <div class="card mb-2">
            <div class="label">${s.heading} (~${s.estimatedMinutes} min)</div>
            <p style="white-space:pre-wrap;font-size:0.9375rem">${s.content}</p>
          </div>
        `;
      });

      html += `<button class="btn btn-secondary btn-block mt-1" id="use-talk-outline-btn">
        Use This as Talk Content
      </button>`;
    }

    if (outline.tips?.length) {
      html += '<div class="card mt-2"><div class="label">Tips</div>';
      outline.tips.forEach(t => {
        html += `<p style="margin-bottom:4px;font-size:0.875rem">&bull; ${t}</p>`;
      });
      html += '</div>';
    }

    el.innerHTML = html;

    $('#use-talk-outline-btn')?.addEventListener('click', () => {
      const contentText = outline.sections.map(s => `${s.heading}\n\n${s.content}`).join('\n\n---\n\n');
      $('#talk-content-input').value = contentText;
      this.currentEntry.content = contentText;
      toast('Outline added to content');
    });
  }

  buildTalkSections() {
    const content = this.currentEntry.content || this.currentEntry.topic;
    if (!content) {
      this.talkSections = [];
      return;
    }
    const raw = content.split(/\n{2,}|---/).map(s => s.trim()).filter(s => s.length > 0);
    this.talkSections = raw.length > 0 ? raw : [content];
    this.currentSectionIndex = 0;
  }

  // --- Lesson Live ---

  renderLessonLive() {
    if (!this.currentEntry) {
      location.hash = '#lessons';
      return;
    }

    this.isLive = true;
    this.timerSeconds = 0;
    this.currentPointIndex = 0;

    const hasPlan = this.lessonPlan.length > 0;

    let planHtml = '';
    if (hasPlan) {
      planHtml = `<div class="live-plan-scroll" id="live-plan-scroll">`;
      this.lessonPlan.forEach((q, i) => {
        const state = i === 0 ? 'active' : '';
        planHtml += `
          <div class="live-plan-item ${state}" data-index="${i}">
            <div class="plan-index">${i + 1} of ${this.lessonPlan.length}</div>
            <div class="plan-question">${q.question}</div>
            ${q.cross_reference ? `<div class="plan-ref">${q.cross_reference}</div>` : ''}
          </div>
        `;
      });
      planHtml += '</div>';
    } else {
      planHtml = `
        <div class="no-plan-message">
          <h3>Free-form Discussion</h3>
          <p>AI is listening and will provide suggestions based on your discussion.</p>
        </div>
        <div class="live-plan-scroll" id="live-plan-scroll" style="flex:1"></div>
      `;
    }

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

        <div class="live-content">
          ${planHtml}
          <div class="transcript-preview" id="transcript-box">
            <div class="transcript-label">Listening...</div>
            <div id="transcript-text"></div>
          </div>
        </div>

        <button class="help-btn" id="help-btn" title="I need help">?</button>

        <div class="suggestion-bar" id="suggestion-bar">
          <div class="suggestion-header">
            <div class="suggestion-label" id="suggestion-label">
              <span class="suggestion-type-icon" id="suggestion-icon">&#128161;</span>
              <span id="suggestion-type">AI Suggestion</span>
            </div>
            <button class="suggestion-dismiss" id="dismiss-suggestion">&times;</button>
          </div>
          <div class="suggestion-text" id="suggestion-text"></div>
          <ul class="suggestion-bullets" id="suggestion-bullets"></ul>
          <div class="suggestion-reference" id="suggestion-reference"></div>
        </div>
      </div>
    `;

    showScreen('screen-lesson-live');

    // Plan item click to jump
    if (hasPlan) {
      $('#live-plan-scroll').addEventListener('click', (e) => {
        const item = e.target.closest('.live-plan-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index);
        this.jumpToPoint(idx);
      });
    }

    this.startLiveCommon('lesson');
  }

  jumpToPoint(idx) {
    if (idx < 0 || idx >= this.lessonPlan.length) return;

    // Update states
    document.querySelectorAll('.live-plan-item').forEach((el, i) => {
      el.classList.remove('active', 'past');
      if (i < idx) el.classList.add('past');
      if (i === idx) el.classList.add('active');
    });

    this.currentPointIndex = idx;

    // Scroll into view
    const activeItem = document.querySelector(`.live-plan-item[data-index="${idx}"]`);
    activeItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // --- Talk Live (Teleprompter) ---

  renderTalkLive() {
    if (!this.currentEntry) {
      location.hash = '#talks';
      return;
    }

    this.isLive = true;
    this.timerSeconds = 0;
    this.currentSectionIndex = 0;

    const hasSections = this.talkSections.length > 0;

    let sectionsHtml = '';
    if (hasSections) {
      this.talkSections.forEach((text, i) => {
        const state = i === 0 ? 'active' : 'upcoming';
        sectionsHtml += `<div class="teleprompter-section ${state}" data-section="${i}">${text}</div>`;
      });
    } else {
      sectionsHtml = `
        <div class="no-plan-message">
          <h3>Free-form Talk</h3>
          <p>AI is listening and will provide delivery feedback.</p>
        </div>
      `;
    }

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
          ${hasSections ? `<div class="teleprompter-progress" id="teleprompter-progress">Section 1 of ${this.talkSections.length}</div>` : ''}
          ${sectionsHtml}
        </div>

        <button class="help-btn" id="help-btn" title="I need help">?</button>

        <div class="suggestion-bar" id="suggestion-bar">
          <div class="suggestion-header">
            <div class="suggestion-label" id="suggestion-label">
              <span class="suggestion-type-icon" id="suggestion-icon">&#128161;</span>
              <span id="suggestion-type">Delivery Tip</span>
            </div>
            <button class="suggestion-dismiss" id="dismiss-suggestion">&times;</button>
          </div>
          <div class="suggestion-text" id="suggestion-text"></div>
          <ul class="suggestion-bullets" id="suggestion-bullets"></ul>
          <div class="suggestion-reference" id="suggestion-reference"></div>
        </div>
      </div>
    `;

    showScreen('screen-talk-live');

    // Tap to advance section
    if (hasSections) {
      $('#teleprompter-area').addEventListener('click', (e) => {
        if (e.target.closest('.no-plan-message')) return;
        this.advanceSection();
      });
    }

    this.startLiveCommon('talk');
  }

  advanceSection() {
    if (this.currentSectionIndex < this.talkSections.length - 1) {
      const current = document.querySelector(`.teleprompter-section[data-section="${this.currentSectionIndex}"]`);
      if (current) {
        current.classList.remove('active');
        current.classList.add('past');
      }

      this.currentSectionIndex++;

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

    // Help button
    $('#help-btn').addEventListener('click', async () => {
      if (this.helpRequested) return;
      this.helpRequested = true;
      const btn = $('#help-btn');
      btn.classList.add('loading');
      btn.textContent = '...';

      try {
        const transcript = this.speech.getTranscript();
        const recent = transcript.slice(-500);
        const currentPoint = mode === 'lesson'
          ? (this.lessonPlan[this.currentPointIndex]?.question || '')
          : (this.talkSections[this.currentSectionIndex] || '');

        const suggestion = await this.ai.generateImmediateHelp(
          recent,
          this.currentEntry,
          currentPoint,
          this.hasNoPlan
        );
        this.showSuggestion(suggestion);
      } catch (e) {
        toast('Could not get help');
        console.error(e);
      }

      btn.classList.remove('loading');
      btn.textContent = '?';
      this.helpRequested = false;
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
        const display = text.length > 150 ? '...' + text.slice(-150) : text;
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
            this.lessonPlan[this.currentPointIndex]?.question || '',
            this.hasNoPlan
          );
        } else {
          suggestion = await this.ai.generateTalkDeliverySuggestion(
            chunk,
            this.currentEntry.content || this.currentEntry.topic,
            this.talkSections[this.currentSectionIndex] || ''
          );
        }
        if (suggestion.suggestion) {
          this.showSuggestion(suggestion);
        }
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
          mode,
          this.hasNoPlan
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
    const iconEl = $('#suggestion-icon');
    const textEl = $('#suggestion-text');
    const bulletsEl = $('#suggestion-bullets');
    const refEl = $('#suggestion-reference');
    if (!bar || !textEl) return;

    const typeConfig = {
      scripture: { label: 'Scripture', icon: '&#128214;' },
      doctrine: { label: 'Doctrine', icon: '&#128220;' },
      question: { label: 'Question', icon: '&#10067;' },
      redirect: { label: 'Refocus', icon: '&#10145;' },
      help: { label: 'Help', icon: '&#128161;' },
      pacing: { label: 'Pacing', icon: '&#9201;' },
      transition: { label: 'Transition', icon: '&#10145;' },
      emphasis: { label: 'Emphasis', icon: '&#10071;' },
      encouragement: { label: 'Encouragement', icon: '&#128079;' }
    };

    const config = typeConfig[suggestion.type] || { label: 'Suggestion', icon: '&#128161;' };

    if (typeEl) typeEl.textContent = config.label;
    if (iconEl) iconEl.innerHTML = config.icon;
    textEl.textContent = suggestion.suggestion || '';

    // Bullets
    if (bulletsEl) {
      bulletsEl.innerHTML = '';
      if (suggestion.bullets?.length) {
        suggestion.bullets.forEach(b => {
          const li = document.createElement('li');
          li.textContent = b;
          bulletsEl.appendChild(li);
        });
      }
    }

    // Reference
    if (refEl) {
      refEl.textContent = suggestion.reference || '';
      refEl.style.display = suggestion.reference ? '' : 'none';
    }

    bar.classList.add('visible');
  }

  hideSuggestion() {
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
      const coveredCount = this.hasNoPlan ? 0 : Math.min(this.currentPointIndex + 1, this.lessonPlan.length);
      const totalCount = this.lessonPlan.length;

      $(`#${screenId}`).innerHTML = `
        <div class="header">
          <div style="width:40px"></div>
          <h1>Summary</h1>
          <div style="width:40px"></div>
        </div>
        <div style="padding:16px;flex:1;overflow-y:auto">
          <div class="summary-header">
            <h2>${title || 'Lesson'}</h2>
            <div class="summary-stat">
              <div class="stat">
                <div class="stat-value">${durationMin}</div>
                <div class="stat-label">Minutes</div>
              </div>
              ${!this.hasNoPlan ? `
              <div class="stat">
                <div class="stat-value">${coveredCount}/${totalCount}</div>
                <div class="stat-label">Questions</div>
              </div>
              ` : ''}
            </div>
          </div>

          ${!this.hasNoPlan && this.lessonPlan.length > 0 ? `
          <div class="prep-section">
            <h3>Coverage</h3>
            <ul class="coverage-list" id="coverage-list"></ul>
          </div>
          ` : ''}

          <div class="prep-section" id="ai-summary-section">
            <h3>AI Summary</h3>
            <div id="ai-summary-content">
              ${(this.ai.hasApiKey() && transcript)
                ? '<div class="ai-loading"><div class="spinner"></div> Generating...</div>'
                : '<p class="text-muted">No transcript available.</p>'}
            </div>
          </div>

          <div class="summary-notes">
            <h3>Notes</h3>
            <textarea id="summary-notes" placeholder="Add any notes...">${this.currentEntry.notes || ''}</textarea>
          </div>

          <div class="summary-actions mt-2">
            <button class="btn btn-secondary" id="save-notes-btn">Save</button>
            <button class="btn btn-primary" id="done-btn">Done</button>
          </div>
        </div>
      `;

      showScreen(screenId);

      // Render coverage
      if (!this.hasNoPlan && this.lessonPlan.length > 0) {
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
      }

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
            <h2>${title || 'Talk'}</h2>
            <div class="summary-stat">
              <div class="stat">
                <div class="stat-value">${durationMin}</div>
                <div class="stat-label">Minutes</div>
              </div>
            </div>
          </div>

          <div class="prep-section" id="ai-summary-section">
            <h3>Delivery Feedback</h3>
            <div id="ai-summary-content">
              ${(this.ai.hasApiKey() && transcript)
                ? '<div class="ai-loading"><div class="spinner"></div> Analyzing...</div>'
                : '<p class="text-muted">No transcript available.</p>'}
            </div>
          </div>

          <div class="summary-notes">
            <h3>Notes</h3>
            <textarea id="summary-notes" placeholder="Add any notes...">${this.currentEntry.notes || ''}</textarea>
          </div>

          <div class="summary-actions mt-2">
            <button class="btn btn-secondary" id="save-notes-btn">Save</button>
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

    // Save notes
    $('#save-notes-btn').addEventListener('click', () => {
      const notes = $('#summary-notes').value;
      this.currentEntry.notes = notes;
      this.saveCurrentSession();
      toast('Saved');
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
      html += '<div class="label">Follow-up</div>';
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
      html += '<div class="label">Improvements</div>';
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
