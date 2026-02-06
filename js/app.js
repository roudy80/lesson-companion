import { AI } from './ai.js';
import { Speech } from './speech.js';
import { $, showScreen, toast, formatTime, renderSessionItem } from './ui.js';

class App {
  constructor() {
    this.ai = new AI();
    this.speech = new Speech();
    this.mode = 'lesson'; // 'lesson' | 'talk'
    this.currentEntry = null;
    this.blocks = []; // flexible blocks for lesson/talk
    this.currentBlockIndex = 0;
    this.timerSeconds = 0;
    this.timerInterval = null;
    this.isLive = false;
    this.hasNoPlan = false;
    this.helpRequested = false;
    this.talkDuration = 10; // default talk duration in minutes
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
        blocks: this.blocks,
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
        blocks: this.blocks,
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
      case 'lesson-live': this.mode = 'lesson'; this.renderLive(); break;
      case 'lesson-summary': this.mode = 'lesson'; this.renderSummary(); break;
      case 'talk-prep': this.mode = 'talk'; this.renderTalkPrep(); break;
      case 'talk-live': this.mode = 'talk'; this.renderLive(); break;
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
        toast('API key is invalid');
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
          <p style="font-size:0.875rem">Add your Gemini API key in
            <a href="#settings" style="color:var(--gold)">Settings</a>.</p>
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
          <p>No lessons yet.</p>
        </div>
      `;
    }

    html += '</div>';

    $('#screen-lessons').innerHTML = html;
    showScreen('screen-lessons');

    $('#quick-start-lesson-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        title: 'Quick Lesson',
        content: '',
        createdAt: new Date().toISOString()
      };
      this.blocks = [];
      this.hasNoPlan = true;
      location.hash = '#lesson-live';
    });

    $('#new-lesson-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        title: '',
        content: '',
        createdAt: new Date().toISOString()
      };
      this.blocks = [];
      this.hasNoPlan = false;
      location.hash = '#lesson-prep';
    });

    if (lessons.length > 0) {
      const list = $('#lesson-list');
      for (const lesson of lessons) {
        list.appendChild(renderSessionItem(lesson, 'lesson', (l) => {
          this.currentEntry = { ...l };
          this.blocks = l.blocks || [];
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
          <p style="font-size:0.875rem">Add your Gemini API key in
            <a href="#settings" style="color:var(--gold)">Settings</a>.</p>
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
          <p>No talks yet.</p>
        </div>
      `;
    }

    html += '</div>';

    $('#screen-talks').innerHTML = html;
    showScreen('screen-talks');

    $('#quick-start-talk-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        topic: 'Quick Talk',
        scriptures: '',
        content: '',
        createdAt: new Date().toISOString()
      };
      this.blocks = [];
      this.hasNoPlan = true;
      location.hash = '#talk-live';
    });

    $('#new-talk-btn').addEventListener('click', () => {
      this.currentEntry = {
        id: Date.now().toString(),
        topic: '',
        scriptures: '',
        content: '',
        createdAt: new Date().toISOString()
      };
      this.blocks = [];
      this.hasNoPlan = false;
      location.hash = '#talk-prep';
    });

    if (talks.length > 0) {
      const list = $('#talk-list');
      for (const talk of talks) {
        list.appendChild(renderSessionItem(talk, 'talk', (t) => {
          this.currentEntry = { ...t };
          this.blocks = t.blocks || [];
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
            <label for="lesson-content-input">Content / Notes (optional)</label>
            <textarea id="lesson-content-input" placeholder="Paste talk content, scriptures, or notes for AI to use...">${entry.content || ''}</textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="generate-blocks-btn"
            ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            Generate Outline
          </button>
        </div>

        <div class="prep-section">
          <h3>Lesson Outline</h3>
          <div class="add-block-row">
            <button class="add-block-btn" data-type="point">+ Point</button>
            <button class="add-block-btn" data-type="scripture">+ Scripture</button>
            <button class="add-block-btn" data-type="question">+ Question</button>
            <button class="add-block-btn" data-type="quote">+ Quote</button>
            <button class="add-block-btn" data-type="note">+ Note</button>
          </div>
          <ul class="block-list" id="block-list"></ul>
        </div>

        <div class="divider">ready?</div>

        <button class="btn btn-success btn-block btn-lg" id="start-without-plan-btn">
          Start Without Outline
        </button>

        <button class="btn btn-primary btn-block btn-lg mt-2" id="start-lesson-btn">
          Start Lesson
        </button>
      </div>
    `;

    showScreen('screen-lesson-prep');
    this.renderBlocks();

    // Add block buttons
    document.querySelectorAll('.add-block-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.addBlock(type);
      });
    });

    // Generate blocks
    $('#generate-blocks-btn').addEventListener('click', async () => {
      const title = $('#lesson-title-input').value.trim();
      const content = $('#lesson-content-input').value.trim();

      if (!title && !content) {
        toast('Enter a title or content first');
        return;
      }

      this.currentEntry.title = title || 'Untitled Lesson';
      this.currentEntry.content = content;

      const btn = $('#generate-blocks-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      try {
        const result = await this.ai.generateLessonBlocks(title, content);
        this.blocks = result.blocks || [];
        this.renderBlocks();
        toast('Outline generated');
      } catch (e) {
        toast(e.message);
      }

      btn.disabled = false;
      btn.textContent = 'Generate Outline';
    });

    // Start without plan
    $('#start-without-plan-btn').addEventListener('click', () => {
      this.currentEntry.title = $('#lesson-title-input').value.trim() || 'Quick Lesson';
      this.currentEntry.content = $('#lesson-content-input').value.trim();
      this.blocks = [];
      this.hasNoPlan = true;
      location.hash = '#lesson-live';
    });

    // Start with plan
    $('#start-lesson-btn').addEventListener('click', () => {
      this.currentEntry.title = $('#lesson-title-input').value.trim() || this.currentEntry.title || 'Lesson';
      this.currentEntry.content = $('#lesson-content-input').value.trim();
      this.currentBlockIndex = 0;
      this.hasNoPlan = this.blocks.length === 0;
      location.hash = '#lesson-live';
    });
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
            <label for="talk-scriptures-input">Scriptures (optional)</label>
            <input type="text" id="talk-scriptures-input" placeholder="e.g. 'Alma 37:37, D&C 19:38'"
              value="${entry.scriptures || ''}">
          </div>
          <div class="input-group">
            <label>Talk Duration</label>
            <div class="duration-selector" id="duration-selector">
              <button class="duration-option ${this.talkDuration === 5 ? 'selected' : ''}" data-duration="5">5 min</button>
              <button class="duration-option ${this.talkDuration === 10 ? 'selected' : ''}" data-duration="10">10 min</button>
              <button class="duration-option ${this.talkDuration === 15 ? 'selected' : ''}" data-duration="15">15 min</button>
              <button class="duration-option ${this.talkDuration === 20 ? 'selected' : ''}" data-duration="20">20+ min</button>
            </div>
          </div>
          <div class="input-group">
            <label for="talk-content-input">Notes / Draft (optional)</label>
            <textarea id="talk-content-input" placeholder="Add notes or a draft for AI to work with...">${entry.content || ''}</textarea>
          </div>
          <button class="btn btn-secondary btn-block" id="generate-talk-blocks-btn"
            ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            Generate Outline
          </button>
        </div>

        <div class="prep-section">
          <h3>Talk Outline</h3>
          <div class="add-block-row">
            <button class="add-block-btn" data-type="point">+ Point</button>
            <button class="add-block-btn" data-type="scripture">+ Scripture</button>
            <button class="add-block-btn" data-type="quote">+ Quote</button>
            <button class="add-block-btn" data-type="note">+ Note</button>
          </div>
          <ul class="block-list" id="block-list"></ul>
        </div>

        <div class="divider">ready?</div>

        <button class="btn btn-success btn-block btn-lg" id="start-talk-without-plan-btn">
          Start Without Outline
        </button>

        <button class="btn btn-primary btn-block btn-lg mt-2" id="start-talk-btn">
          Start Talk
        </button>
      </div>
    `;

    showScreen('screen-talk-prep');
    this.renderBlocks();

    // Duration selector
    document.querySelectorAll('.duration-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.talkDuration = parseInt(btn.dataset.duration);
      });
    });

    // Add block buttons
    document.querySelectorAll('.add-block-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.addBlock(type);
      });
    });

    // Generate blocks
    $('#generate-talk-blocks-btn').addEventListener('click', async () => {
      const topic = $('#talk-topic-input').value.trim();
      const scriptures = $('#talk-scriptures-input').value.trim();
      const content = $('#talk-content-input').value.trim();

      if (!topic && !content) {
        toast('Enter a topic or content first');
        return;
      }

      this.currentEntry.topic = topic || 'Untitled Talk';
      this.currentEntry.scriptures = scriptures;
      this.currentEntry.content = content;

      const btn = $('#generate-talk-blocks-btn');
      btn.disabled = true;
      btn.textContent = 'Generating...';

      try {
        const result = await this.ai.generateTalkBlocks(topic, scriptures, content, this.talkDuration);
        this.blocks = result.blocks || [];
        this.renderBlocks();
        toast('Outline generated');
      } catch (e) {
        toast(e.message);
      }

      btn.disabled = false;
      btn.textContent = 'Generate Outline';
    });

    // Start without plan
    $('#start-talk-without-plan-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || 'Quick Talk';
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim();
      this.currentEntry.content = $('#talk-content-input').value.trim();
      this.blocks = [];
      this.hasNoPlan = true;
      location.hash = '#talk-live';
    });

    // Start with plan
    $('#start-talk-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || this.currentEntry.topic || 'Talk';
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim();
      this.currentEntry.content = $('#talk-content-input').value.trim();
      this.currentBlockIndex = 0;
      this.hasNoPlan = this.blocks.length === 0;
      location.hash = '#talk-live';
    });
  }

  // --- Block Management ---

  addBlock(type) {
    const typeLabels = {
      point: 'Key Point',
      scripture: 'Scripture Reference',
      question: 'Discussion Question',
      quote: 'Quote',
      note: 'Note'
    };

    const content = prompt(`Enter ${typeLabels[type]}:`);
    if (content?.trim()) {
      this.blocks.push({
        type,
        content: content.trim(),
        detail: ''
      });
      this.renderBlocks();
    }
  }

  renderBlocks() {
    const list = $('#block-list');
    if (!list) return;

    list.innerHTML = '';

    if (this.blocks.length === 0) {
      list.innerHTML = '<p class="text-muted text-center" style="padding:20px">No blocks yet. Add manually or generate with AI.</p>';
      return;
    }

    this.blocks.forEach((block, i) => {
      const item = document.createElement('li');
      item.className = `block-item type-${block.type}`;
      item.innerHTML = `
        <span class="block-type-badge">${block.type}</span>
        <div class="block-content">${block.content}</div>
        ${block.detail ? `<div class="block-detail">${block.detail}</div>` : ''}
        <div class="block-actions">
          <button class="edit" title="Edit">&#9998;</button>
          <button class="delete" title="Delete">&times;</button>
        </div>
      `;

      item.querySelector('.edit').addEventListener('click', (e) => {
        e.stopPropagation();
        const newContent = prompt('Edit:', block.content);
        if (newContent?.trim()) {
          block.content = newContent.trim();
          this.renderBlocks();
        }
      });

      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.blocks.splice(i, 1);
        this.renderBlocks();
      });

      list.appendChild(item);
    });
  }

  // --- Live Mode (Shared for Lesson and Talk) ---

  renderLive() {
    if (!this.currentEntry) {
      location.hash = this.mode === 'lesson' ? '#lessons' : '#talks';
      return;
    }

    this.isLive = true;
    this.timerSeconds = 0;
    this.currentBlockIndex = 0;

    const screenId = this.mode === 'lesson' ? 'screen-lesson-live' : 'screen-talk-live';
    const hasPlan = this.blocks.length > 0;

    let blocksHtml = '';
    if (hasPlan) {
      blocksHtml = '<div class="live-plan-scroll" id="live-plan-scroll">';
      this.blocks.forEach((block, i) => {
        const state = i === 0 ? 'active' : '';
        blocksHtml += `
          <div class="live-block-item type-${block.type} ${state}" data-index="${i}">
            <span class="block-type-badge">${block.type}</span>
            <div class="block-content">${block.content}</div>
            ${block.detail ? `<div class="block-detail">${block.detail}</div>` : ''}
          </div>
        `;
      });
      blocksHtml += '</div>';
    } else {
      blocksHtml = `
        <div class="live-plan-scroll" id="live-plan-scroll">
          <div class="no-plan-message">
            <h3>Free-form ${this.mode === 'lesson' ? 'Discussion' : 'Talk'}</h3>
            <p>AI is listening and will provide suggestions.</p>
          </div>
        </div>
      `;
    }

    $(`#${screenId}`).innerHTML = `
      <div class="live-screen">
        <div class="live-top-bar">
          <div class="timer" id="live-timer">00:00</div>
          <div class="mic-status">
            <span class="mic-dot" id="mic-dot"></span>
            <span id="mic-label">Mic off</span>
          </div>
          <button class="stop-btn" id="stop-btn">End</button>
        </div>

        <div class="live-content">
          ${blocksHtml}
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
              <span id="suggestion-type">Suggestion</span>
            </div>
            <button class="suggestion-dismiss" id="dismiss-suggestion">&times;</button>
          </div>
          <div class="suggestion-text" id="suggestion-text"></div>
          <ul class="suggestion-bullets" id="suggestion-bullets"></ul>
          <div class="suggestion-reference" id="suggestion-reference"></div>
        </div>
      </div>
    `;

    showScreen(screenId);

    // Block click to jump
    if (hasPlan) {
      $('#live-plan-scroll').addEventListener('click', (e) => {
        const item = e.target.closest('.live-block-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index);
        this.jumpToBlock(idx);
      });
    }

    this.startLiveCommon();
  }

  jumpToBlock(idx) {
    if (idx < 0 || idx >= this.blocks.length) return;

    document.querySelectorAll('.live-block-item').forEach((el, i) => {
      el.classList.remove('active', 'past');
      if (i < idx) el.classList.add('past');
      if (i === idx) el.classList.add('active');
    });

    this.currentBlockIndex = idx;

    const activeItem = document.querySelector(`.live-block-item[data-index="${idx}"]`);
    activeItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  startLiveCommon() {
    // Timer
    this.timerInterval = setInterval(() => {
      this.timerSeconds++;
      const el = $('#live-timer');
      if (el) el.textContent = formatTime(this.timerSeconds);
    }, 1000);

    // Stop button
    $('#stop-btn').addEventListener('click', () => {
      this.saveCurrentSession();
      this.stopLive();
      location.hash = this.mode === 'lesson' ? '#lesson-summary' : '#talk-summary';
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
        const currentBlock = this.blocks[this.currentBlockIndex]?.content || '';

        const suggestion = await this.ai.generateImmediateHelp(
          recent,
          this.currentEntry,
          currentBlock,
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

    // Speech callbacks
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

    this.speech.onChunkReady = async (chunk) => {
      if (!this.ai.hasApiKey() || !this.isLive) return;
      try {
        const currentBlock = this.blocks[this.currentBlockIndex]?.content || '';
        let suggestion;

        if (this.mode === 'lesson') {
          suggestion = await this.ai.generateLiveSuggestion(
            chunk,
            this.currentEntry,
            currentBlock,
            this.hasNoPlan
          );
        } else {
          suggestion = await this.ai.generateTalkDeliverySuggestion(
            chunk,
            this.currentEntry.content || this.currentEntry.topic,
            currentBlock
          );
        }

        if (suggestion.suggestion) {
          this.showSuggestion(suggestion);
        }
      } catch (e) {
        console.error('Suggestion error:', e);
      }
    };

    this.speech.onAudioChunkReady = async (base64Audio, mimeType) => {
      if (!this.ai.hasApiKey() || !this.isLive) return;
      try {
        const currentBlock = this.blocks[this.currentBlockIndex]?.content || '';

        const result = await this.ai.transcribeAndSuggest(
          base64Audio,
          mimeType,
          this.currentEntry,
          currentBlock,
          this.mode,
          this.hasNoPlan
        );

        if (result.transcript) {
          this.speech.appendTranscript(result.transcript);
        }
        if (result.suggestion) {
          this.showSuggestion(result);
        }
      } catch (e) {
        console.error('Transcription error:', e);
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
      encouragement: { label: 'Keep Going', icon: '&#128079;' }
    };

    const config = typeConfig[suggestion.type] || { label: 'Suggestion', icon: '&#128161;' };

    if (typeEl) typeEl.textContent = config.label;
    if (iconEl) iconEl.innerHTML = config.icon;
    textEl.textContent = suggestion.suggestion || '';

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

  // --- Summary ---

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
    const coveredBlocks = this.hasNoPlan ? 0 : Math.min(this.currentBlockIndex + 1, this.blocks.length);
    const totalBlocks = this.blocks.length;

    $(`#${screenId}`).innerHTML = `
      <div class="header">
        <div style="width:40px"></div>
        <h1>Summary</h1>
        <div style="width:40px"></div>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto">
        <div class="summary-header">
          <h2>${title || (this.mode === 'lesson' ? 'Lesson' : 'Talk')}</h2>
          <div class="summary-stat">
            <div class="stat">
              <div class="stat-value">${durationMin}</div>
              <div class="stat-label">Minutes</div>
            </div>
            ${totalBlocks > 0 ? `
            <div class="stat">
              <div class="stat-value">${coveredBlocks}/${totalBlocks}</div>
              <div class="stat-label">Blocks</div>
            </div>
            ` : ''}
          </div>
        </div>

        <div class="prep-section" id="ai-summary-section">
          <h3>${this.mode === 'lesson' ? 'AI Summary' : 'Delivery Feedback'}</h3>
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

    // Generate AI summary
    if (this.ai.hasApiKey() && transcript) {
      try {
        let summary;
        if (this.mode === 'lesson') {
          summary = await this.ai.generateLessonSummary(title, transcript, coveredBlocks, totalBlocks, durationMin);
        } else {
          summary = await this.ai.generateTalkSummary(title, transcript, durationMin);
        }
        this.currentEntry.summary = summary;
        this.renderAISummary(summary);
      } catch (e) {
        $('#ai-summary-content').innerHTML = `<p style="color:var(--danger)">${e.message}</p>`;
      }
    }

    $('#save-notes-btn').addEventListener('click', () => {
      this.currentEntry.notes = $('#summary-notes').value;
      this.saveCurrentSession();
      toast('Saved');
    });

    $('#done-btn').addEventListener('click', () => {
      this.speech.reset();
      location.hash = backHash;
    });
  }

  renderAISummary(summary) {
    const el = $('#ai-summary-content');
    if (!el) return;

    let html = '';

    if (this.mode === 'lesson') {
      if (summary.themes?.length) {
        html += '<div class="card mb-2"><div class="label">Themes</div>';
        summary.themes.forEach(t => { html += `<p>&bull; ${t}</p>`; });
        html += '</div>';
      }
      if (summary.insights) {
        html += `<div class="card mb-2"><div class="label">Key Insight</div><p>${summary.insights}</p></div>`;
      }
      if (summary.followUp?.length) {
        html += '<div class="card"><div class="label">Follow-up</div>';
        summary.followUp.forEach(f => { html += `<p>&bull; ${f}</p>`; });
        html += '</div>';
      }
    } else {
      if (summary.assessment) {
        html += `<div class="card mb-2"><div class="label">Overall</div><p>${summary.assessment}</p></div>`;
      }
      if (summary.strengths?.length) {
        html += '<div class="card mb-2"><div class="label">Strengths</div>';
        summary.strengths.forEach(s => { html += `<p style="color:var(--success)">&bull; ${s}</p>`; });
        html += '</div>';
      }
      if (summary.improvements?.length) {
        html += '<div class="card mb-2"><div class="label">Improve</div>';
        summary.improvements.forEach(s => { html += `<p style="color:var(--warning)">&bull; ${s}</p>`; });
        html += '</div>';
      }
      if (summary.encouragement) {
        html += `<div class="card"><p style="color:var(--gold);font-style:italic">${summary.encouragement}</p></div>`;
      }
    }

    el.innerHTML = html || '<p class="text-muted">No summary generated.</p>';
  }
}

// Boot
const app = new App();
app.init();
