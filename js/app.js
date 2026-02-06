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
    this.isPractice = false; // practice mode (no AI)
    this.hasNoPlan = false;
    this.helpRequested = false;
    this.talkDuration = 10;
    this.engagementLevel = 'moderate';
    this.chatMessages = [];
    this.deletedBlock = null; // for undo
    this.blockStartTimes = []; // track time per block
    this.timeWarningShown = {}; // track which warnings shown
    this.draggedBlockIndex = null;
    this.expandedBlockIndex = null; // for prep editing
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

  // --- Time Estimation ---

  calculateTimeEstimate() {
    if (this.blocks.length === 0) return { min: 0, max: 0 };

    const baseTimes = {
      point: { min: 2, max: 4 },
      scripture: { min: 2, max: 5 },
      question: { min: 3, max: 8 },
      quote: { min: 1, max: 3 },
      note: { min: 0.5, max: 1 }
    };

    const multipliers = {
      talkative: { min: 1.3, max: 1.8 },
      moderate: { min: 1.0, max: 1.0 },
      quiet: { min: 0.6, max: 0.7 }
    };

    const mult = multipliers[this.engagementLevel] || multipliers.moderate;
    let totalMin = 0;
    let totalMax = 0;

    for (const block of this.blocks) {
      const times = baseTimes[block.type] || baseTimes.point;
      totalMin += times.min * mult.min;
      totalMax += times.max * mult.max;
    }

    return {
      min: Math.round(totalMin),
      max: Math.round(totalMax)
    };
  }

  renderTimeEstimate() {
    const el = $('#time-estimate');
    if (!el) return;

    const est = this.calculateTimeEstimate();
    if (est.min === 0 && est.max === 0) {
      el.innerHTML = '<span class="time-value">--</span> min';
    } else if (est.min === est.max) {
      el.innerHTML = `<span class="time-value">~${est.min}</span> min`;
    } else {
      el.innerHTML = `<span class="time-value">${est.min}-${est.max}</span> min`;
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

    const hideOn = ['lesson-prep', 'lesson-live', 'lesson-practice', 'lesson-summary', 'talk-prep', 'talk-live', 'talk-practice', 'talk-summary', 'settings'];
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

    if ((this.isLive || this.isPractice) && !route.includes('live') && !route.includes('practice')) {
      this.stopLive();
    }

    this.updateTabBar(route);

    switch (route) {
      case 'settings': this.renderSettings(); break;
      case 'lessons': this.mode = 'lesson'; this.renderLessonsTab(); break;
      case 'talks': this.mode = 'talk'; this.renderTalksTab(); break;
      case 'lesson-prep': this.mode = 'lesson'; this.renderLessonPrep(); break;
      case 'lesson-live': this.mode = 'lesson'; this.isPractice = false; this.renderLive(); break;
      case 'lesson-practice': this.mode = 'lesson'; this.isPractice = true; this.renderLive(); break;
      case 'lesson-summary': this.mode = 'lesson'; this.renderSummary(); break;
      case 'talk-prep': this.mode = 'talk'; this.renderTalkPrep(); break;
      case 'talk-live': this.mode = 'talk'; this.isPractice = false; this.renderLive(); break;
      case 'talk-practice': this.mode = 'talk'; this.isPractice = true; this.renderLive(); break;
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
          <p>Lesson Companion helps you prepare and deliver lessons and talks with AI-powered assistance.</p>
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
      this.chatMessages = [];
      this.hasNoPlan = false;
      location.hash = '#lesson-prep';
    });

    if (lessons.length > 0) {
      const list = $('#lesson-list');
      for (const lesson of lessons) {
        list.appendChild(renderSessionItem(lesson, 'lesson', (l) => {
          this.currentEntry = { ...l };
          this.blocks = l.blocks || [];
          this.chatMessages = [];
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
      this.chatMessages = [];
      this.hasNoPlan = false;
      location.hash = '#talk-prep';
    });

    if (talks.length > 0) {
      const list = $('#talk-list');
      for (const talk of talks) {
        list.appendChild(renderSessionItem(talk, 'talk', (t) => {
          this.currentEntry = { ...t };
          this.blocks = t.blocks || [];
          this.chatMessages = [];
          this.hasNoPlan = false;
          location.hash = '#talk-prep';
        }));
      }
    }
  }

  // --- Export Outline ---

  exportOutline() {
    if (this.blocks.length === 0) {
      toast('No outline to export');
      return;
    }

    const title = this.mode === 'lesson' ? this.currentEntry?.title : this.currentEntry?.topic;
    let text = `${title || 'Outline'}\n${'='.repeat(40)}\n\n`;

    this.blocks.forEach((block, i) => {
      const typeLabel = block.type.charAt(0).toUpperCase() + block.type.slice(1);
      text += `${i + 1}. [${typeLabel}] ${block.content}\n`;
      if (block.notes) {
        text += `   Notes: ${block.notes}\n`;
      }
      if (block.detail) {
        text += `   ${block.detail}\n`;
      }
      text += '\n';
    });

    navigator.clipboard.writeText(text).then(() => {
      toast('Outline copied to clipboard');
    }).catch(() => {
      toast('Could not copy');
    });
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
        <button class="header-btn export-btn" id="export-btn" title="Copy outline">&#128203;</button>
      </div>
      <div style="padding:16px;flex:1;overflow-y:auto" class="no-tab-padding">
        <div class="entry-form">
          <div class="input-group">
            <label for="lesson-title-input">Lesson Title</label>
            <input type="text" id="lesson-title-input" placeholder="e.g. 'Faith in Uncertain Times'"
              value="${entry.title || ''}">
          </div>
          <div class="input-group">
            <label for="lesson-url-input">Conference Talk URL (optional)</label>
            <div class="url-input-row">
              <input type="url" id="lesson-url-input" placeholder="Paste churchofjesuschrist.org URL...">
              <button class="btn btn-sm" id="fetch-url-btn" ${!this.ai.hasApiKey() ? 'disabled' : ''}>Fetch</button>
            </div>
          </div>
          <div class="input-group">
            <label for="lesson-content-input">Content / Notes</label>
            <textarea id="lesson-content-input" placeholder="Paste talk content, scriptures, or notes...">${entry.content || ''}</textarea>
          </div>
        </div>

        <div class="prep-section">
          <div class="prep-section-header">
            <h3>Lesson Outline</h3>
            <div class="time-estimate" id="time-estimate">
              <span class="time-value">--</span> min
            </div>
          </div>
          <div class="engagement-toggle" id="engagement-toggle">
            <button class="engagement-option ${this.engagementLevel === 'quiet' ? 'selected' : ''}" data-level="quiet">Quiet</button>
            <button class="engagement-option ${this.engagementLevel === 'moderate' ? 'selected' : ''}" data-level="moderate">Moderate</button>
            <button class="engagement-option ${this.engagementLevel === 'talkative' ? 'selected' : ''}" data-level="talkative">Talkative</button>
          </div>
          <div class="add-block-row">
            <button class="add-block-btn" data-type="point">+ Point</button>
            <button class="add-block-btn" data-type="scripture">+ Scripture</button>
            <button class="add-block-btn" data-type="question">+ Question</button>
            <button class="add-block-btn" data-type="quote">+ Quote</button>
            <button class="add-block-btn" data-type="note">+ Note</button>
          </div>
          <div id="undo-bar" class="undo-bar hidden">
            <span>Block deleted</span>
            <button id="undo-btn">Undo</button>
          </div>
          <ul class="block-list" id="block-list"></ul>
        </div>

        <div class="chat-container">
          <div class="chat-header">
            <h3>&#128172; Plan with AI</h3>
          </div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-row">
            <input type="text" id="chat-input" placeholder="Ask AI to help plan your lesson..." ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            <button class="btn btn-primary btn-sm" id="chat-send-btn" ${!this.ai.hasApiKey() ? 'disabled' : ''}>Send</button>
          </div>
        </div>

        <div class="divider">ready?</div>

        <div class="start-options">
          <button class="btn btn-secondary btn-block" id="practice-btn">
            &#9202; Practice (No AI)
          </button>
          <button class="btn btn-primary btn-block" id="start-lesson-btn">
            &#127908; Start Lesson
          </button>
        </div>
      </div>
    `;

    showScreen('screen-lesson-prep');
    this.renderBlocks();
    this.renderTimeEstimate();
    this.renderChatMessages();

    // Export
    $('#export-btn').addEventListener('click', () => this.exportOutline());

    // Undo
    $('#undo-btn').addEventListener('click', () => {
      if (this.deletedBlock) {
        this.blocks.splice(this.deletedBlock.index, 0, this.deletedBlock.block);
        this.deletedBlock = null;
        $('#undo-bar').classList.add('hidden');
        this.renderBlocks();
        this.renderTimeEstimate();
      }
    });

    // Engagement toggle
    document.querySelectorAll('.engagement-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.engagement-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.engagementLevel = btn.dataset.level;
        this.renderTimeEstimate();
      });
    });

    // Fetch URL
    $('#fetch-url-btn').addEventListener('click', async () => {
      const url = $('#lesson-url-input').value.trim();
      if (!url) {
        toast('Enter a URL first');
        return;
      }

      const btn = $('#fetch-url-btn');
      btn.disabled = true;
      btn.textContent = '...';

      try {
        const result = await this.ai.fetchUrlContent(url);
        if (result.success) {
          if (result.title && !$('#lesson-title-input').value.trim()) {
            $('#lesson-title-input').value = result.title;
            this.currentEntry.title = result.title;
          }
          if (result.content) {
            $('#lesson-content-input').value = result.content;
            this.currentEntry.content = result.content;
          }
          toast('Content loaded');
        } else {
          toast(result.error || 'Could not fetch URL');
        }
      } catch (e) {
        toast(e.message);
      }

      btn.disabled = false;
      btn.textContent = 'Fetch';
    });

    // Add block buttons
    document.querySelectorAll('.add-block-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.addBlock(type);
      });
    });

    // Chat send
    const sendChat = async () => {
      const input = $('#chat-input');
      const message = input.value.trim();
      if (!message) return;

      input.value = '';
      this.chatMessages.push({ role: 'user', text: message });
      this.renderChatMessages();

      this.chatMessages.push({ role: 'assistant', text: '...', typing: true });
      this.renderChatMessages();

      try {
        const title = $('#lesson-title-input').value.trim();
        const content = $('#lesson-content-input').value.trim();
        this.currentEntry.title = title || this.currentEntry.title;
        this.currentEntry.content = content;

        const result = await this.ai.chatPlanLesson(message, this.blocks, {
          title: this.currentEntry.title,
          content: this.currentEntry.content
        });

        this.chatMessages = this.chatMessages.filter(m => !m.typing);
        this.chatMessages.push({ role: 'assistant', text: result.reply });

        if (result.blocksChanged && result.blocks) {
          this.blocks = result.blocks;
          this.renderBlocks();
          this.renderTimeEstimate();
        }

        this.renderChatMessages();
      } catch (e) {
        this.chatMessages = this.chatMessages.filter(m => !m.typing);
        this.chatMessages.push({ role: 'assistant', text: 'Sorry, I had trouble with that. Try again?' });
        this.renderChatMessages();
      }
    };

    $('#chat-send-btn').addEventListener('click', sendChat);
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });

    // Practice mode
    $('#practice-btn').addEventListener('click', () => {
      this.currentEntry.title = $('#lesson-title-input').value.trim() || this.currentEntry.title || 'Lesson';
      this.currentEntry.content = $('#lesson-content-input').value.trim();
      this.currentBlockIndex = 0;
      this.hasNoPlan = this.blocks.length === 0;
      location.hash = '#lesson-practice';
    });

    // Start lesson
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
        <button class="header-btn export-btn" id="export-btn" title="Copy outline">&#128203;</button>
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
            <label for="talk-url-input">Conference Talk URL (optional)</label>
            <div class="url-input-row">
              <input type="url" id="talk-url-input" placeholder="Paste URL for reference material...">
              <button class="btn btn-sm" id="fetch-talk-url-btn" ${!this.ai.hasApiKey() ? 'disabled' : ''}>Fetch</button>
            </div>
          </div>
          <div class="input-group">
            <label for="talk-content-input">Notes / Draft</label>
            <textarea id="talk-content-input" placeholder="Add notes or a draft...">${entry.content || ''}</textarea>
          </div>
        </div>

        <div class="prep-section">
          <div class="prep-section-header">
            <h3>Talk Outline</h3>
            <div class="time-estimate" id="time-estimate">
              <span class="time-value">--</span> min
            </div>
          </div>
          <div class="add-block-row">
            <button class="add-block-btn" data-type="point">+ Point</button>
            <button class="add-block-btn" data-type="scripture">+ Scripture</button>
            <button class="add-block-btn" data-type="quote">+ Quote</button>
            <button class="add-block-btn" data-type="note">+ Note</button>
          </div>
          <div id="undo-bar" class="undo-bar hidden">
            <span>Block deleted</span>
            <button id="undo-btn">Undo</button>
          </div>
          <ul class="block-list" id="block-list"></ul>
        </div>

        <div class="chat-container">
          <div class="chat-header">
            <h3>&#128172; Plan with AI</h3>
          </div>
          <div class="chat-messages" id="chat-messages"></div>
          <div class="chat-input-row">
            <input type="text" id="chat-input" placeholder="Ask AI to help plan your talk..." ${!this.ai.hasApiKey() ? 'disabled' : ''}>
            <button class="btn btn-primary btn-sm" id="chat-send-btn" ${!this.ai.hasApiKey() ? 'disabled' : ''}>Send</button>
          </div>
        </div>

        <div class="divider">ready?</div>

        <div class="start-options">
          <button class="btn btn-secondary btn-block" id="practice-btn">
            &#9202; Practice (No AI)
          </button>
          <button class="btn btn-primary btn-block" id="start-talk-btn">
            &#127908; Start Talk
          </button>
        </div>
      </div>
    `;

    showScreen('screen-talk-prep');
    this.renderBlocks();
    this.renderTimeEstimate();
    this.renderChatMessages();

    // Export
    $('#export-btn').addEventListener('click', () => this.exportOutline());

    // Undo
    $('#undo-btn').addEventListener('click', () => {
      if (this.deletedBlock) {
        this.blocks.splice(this.deletedBlock.index, 0, this.deletedBlock.block);
        this.deletedBlock = null;
        $('#undo-bar').classList.add('hidden');
        this.renderBlocks();
        this.renderTimeEstimate();
      }
    });

    // Duration selector
    document.querySelectorAll('.duration-option').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.duration-option').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        this.talkDuration = parseInt(btn.dataset.duration);
      });
    });

    // Fetch URL
    $('#fetch-talk-url-btn').addEventListener('click', async () => {
      const url = $('#talk-url-input').value.trim();
      if (!url) {
        toast('Enter a URL first');
        return;
      }

      const btn = $('#fetch-talk-url-btn');
      btn.disabled = true;
      btn.textContent = '...';

      try {
        const result = await this.ai.fetchUrlContent(url);
        if (result.success) {
          if (result.content) {
            const existing = $('#talk-content-input').value.trim();
            const newContent = existing ? existing + '\n\n---\n\n' + result.content : result.content;
            $('#talk-content-input').value = newContent;
            this.currentEntry.content = newContent;
          }
          toast('Content loaded');
        } else {
          toast(result.error || 'Could not fetch URL');
        }
      } catch (e) {
        toast(e.message);
      }

      btn.disabled = false;
      btn.textContent = 'Fetch';
    });

    // Add block buttons
    document.querySelectorAll('.add-block-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        this.addBlock(type);
      });
    });

    // Chat send
    const sendChat = async () => {
      const input = $('#chat-input');
      const message = input.value.trim();
      if (!message) return;

      input.value = '';
      this.chatMessages.push({ role: 'user', text: message });
      this.renderChatMessages();

      this.chatMessages.push({ role: 'assistant', text: '...', typing: true });
      this.renderChatMessages();

      try {
        const topic = $('#talk-topic-input').value.trim();
        const scriptures = $('#talk-scriptures-input').value.trim();
        const content = $('#talk-content-input').value.trim();
        this.currentEntry.topic = topic || this.currentEntry.topic;
        this.currentEntry.scriptures = scriptures;
        this.currentEntry.content = content;

        const result = await this.ai.chatPlanTalk(message, this.blocks, {
          topic: this.currentEntry.topic,
          scriptures: this.currentEntry.scriptures,
          content: this.currentEntry.content,
          duration: this.talkDuration
        });

        this.chatMessages = this.chatMessages.filter(m => !m.typing);
        this.chatMessages.push({ role: 'assistant', text: result.reply });

        if (result.blocksChanged && result.blocks) {
          this.blocks = result.blocks;
          this.renderBlocks();
          this.renderTimeEstimate();
        }

        this.renderChatMessages();
      } catch (e) {
        this.chatMessages = this.chatMessages.filter(m => !m.typing);
        this.chatMessages.push({ role: 'assistant', text: 'Sorry, I had trouble with that. Try again?' });
        this.renderChatMessages();
      }
    };

    $('#chat-send-btn').addEventListener('click', sendChat);
    $('#chat-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });

    // Practice mode
    $('#practice-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || this.currentEntry.topic || 'Talk';
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim();
      this.currentEntry.content = $('#talk-content-input').value.trim();
      this.currentBlockIndex = 0;
      this.hasNoPlan = this.blocks.length === 0;
      location.hash = '#talk-practice';
    });

    // Start talk
    $('#start-talk-btn').addEventListener('click', () => {
      this.currentEntry.topic = $('#talk-topic-input').value.trim() || this.currentEntry.topic || 'Talk';
      this.currentEntry.scriptures = $('#talk-scriptures-input').value.trim();
      this.currentEntry.content = $('#talk-content-input').value.trim();
      this.currentBlockIndex = 0;
      this.hasNoPlan = this.blocks.length === 0;
      location.hash = '#talk-live';
    });
  }

  // --- Chat Messages ---

  renderChatMessages() {
    const el = $('#chat-messages');
    if (!el) return;

    if (this.chatMessages.length === 0) {
      el.innerHTML = '<div class="chat-empty">Chat with AI to collaboratively build your outline.</div>';
      return;
    }

    el.innerHTML = '';
    for (const msg of this.chatMessages) {
      const div = document.createElement('div');
      div.className = `chat-message ${msg.role}${msg.typing ? ' typing' : ''}`;
      div.textContent = msg.text;
      el.appendChild(div);
    }

    el.scrollTop = el.scrollHeight;
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
        detail: '',
        notes: ''
      });
      this.renderBlocks();
      this.renderTimeEstimate();
    }
  }

  renderBlocks() {
    const list = $('#block-list');
    if (!list) return;

    list.innerHTML = '';

    if (this.blocks.length === 0) {
      list.innerHTML = '<p class="text-muted text-center" style="padding:20px">No blocks yet. Add manually or chat with AI.</p>';
      return;
    }

    this.blocks.forEach((block, i) => {
      const item = document.createElement('li');
      item.className = `block-item type-${block.type}${this.expandedBlockIndex === i ? ' expanded' : ''}`;
      item.draggable = true;
      item.dataset.index = i;

      const isExpanded = this.expandedBlockIndex === i;

      item.innerHTML = `
        <div class="block-header">
          <span class="drag-handle">&#9776;</span>
          <span class="block-type-badge">${block.type}</span>
          <div class="block-content">${block.content}</div>
          <div class="block-actions">
            <button class="expand" title="Expand">&#9660;</button>
            <button class="delete" title="Delete">&times;</button>
          </div>
        </div>
        ${isExpanded ? `
        <div class="block-expanded">
          <div class="input-group">
            <label>Content</label>
            <input type="text" class="block-content-input" value="${block.content}">
          </div>
          <div class="input-group">
            <label>Your Notes / Script</label>
            <textarea class="block-notes-input" placeholder="What you want to say...">${block.notes || ''}</textarea>
          </div>
          ${block.detail ? `<div class="block-detail-display">${block.detail}</div>` : ''}
          <button class="btn btn-sm btn-primary save-block-btn">Save</button>
        </div>
        ` : (block.notes ? `<div class="block-notes-preview">${block.notes}</div>` : '')}
      `;

      // Drag events
      item.addEventListener('dragstart', (e) => {
        this.draggedBlockIndex = i;
        item.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
      });

      item.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        this.draggedBlockIndex = null;
        document.querySelectorAll('.block-item.drag-over').forEach(el => el.classList.remove('drag-over'));
      });

      item.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (this.draggedBlockIndex !== null && this.draggedBlockIndex !== i) {
          item.classList.add('drag-over');
        }
      });

      item.addEventListener('dragleave', () => {
        item.classList.remove('drag-over');
      });

      item.addEventListener('drop', (e) => {
        e.preventDefault();
        item.classList.remove('drag-over');
        if (this.draggedBlockIndex !== null && this.draggedBlockIndex !== i) {
          const draggedBlock = this.blocks.splice(this.draggedBlockIndex, 1)[0];
          this.blocks.splice(i, 0, draggedBlock);
          this.expandedBlockIndex = null;
          this.renderBlocks();
        }
      });

      // Expand/collapse
      item.querySelector('.expand').addEventListener('click', (e) => {
        e.stopPropagation();
        this.expandedBlockIndex = this.expandedBlockIndex === i ? null : i;
        this.renderBlocks();
      });

      // Delete
      item.querySelector('.delete').addEventListener('click', (e) => {
        e.stopPropagation();
        this.deletedBlock = { index: i, block: this.blocks[i] };
        this.blocks.splice(i, 1);
        this.expandedBlockIndex = null;
        $('#undo-bar')?.classList.remove('hidden');
        setTimeout(() => {
          if (this.deletedBlock) {
            $('#undo-bar')?.classList.add('hidden');
            this.deletedBlock = null;
          }
        }, 5000);
        this.renderBlocks();
        this.renderTimeEstimate();
      });

      // Save expanded
      if (isExpanded) {
        item.querySelector('.save-block-btn').addEventListener('click', (e) => {
          e.stopPropagation();
          block.content = item.querySelector('.block-content-input').value.trim() || block.content;
          block.notes = item.querySelector('.block-notes-input').value.trim();
          this.expandedBlockIndex = null;
          this.renderBlocks();
        });
      }

      list.appendChild(item);
    });
  }

  // --- Live Mode ---

  renderLive() {
    if (!this.currentEntry) {
      location.hash = this.mode === 'lesson' ? '#lessons' : '#talks';
      return;
    }

    this.isLive = !this.isPractice;
    this.timerSeconds = 0;
    this.currentBlockIndex = 0;
    this.blockStartTimes = [0];
    this.timeWarningShown = {};

    const screenId = this.mode === 'lesson'
      ? (this.isPractice ? 'screen-lesson-practice' : 'screen-lesson-live')
      : (this.isPractice ? 'screen-talk-practice' : 'screen-talk-live');
    const hasPlan = this.blocks.length > 0;

    let blocksHtml = '';
    if (hasPlan) {
      blocksHtml = '<div class="live-plan-scroll" id="live-plan-scroll">';
      this.blocks.forEach((block, i) => {
        const state = i === 0 ? 'active' : '';
        blocksHtml += `
          <div class="live-block-item type-${block.type} ${state}" data-index="${i}">
            <div class="live-block-header">
              <span class="block-type-badge">${block.type}</span>
              <span class="block-time" id="block-time-${i}"></span>
            </div>
            <div class="block-content">${block.content}</div>
            ${block.notes ? `<div class="block-notes-live">${block.notes}</div>` : ''}
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
            <p>${this.isPractice ? 'Practice mode - tap timer to advance.' : 'AI is listening and will provide suggestions.'}</p>
          </div>
        </div>
      `;
    }

    const targetMin = this.mode === 'talk' ? this.talkDuration : 45;

    // Get the container - use existing screen or create in lesson-live/talk-live
    const containerEl = $(`#${screenId}`) || $(`#screen-${this.mode}-live`);

    containerEl.innerHTML = `
      <div class="live-screen${this.isPractice ? ' practice-mode' : ''}">
        <div class="live-top-bar">
          <div class="timer${this.isPractice ? ' tappable' : ''}" id="live-timer">00:00</div>
          ${!this.isPractice ? `
          <div class="mic-status">
            <span class="mic-dot" id="mic-dot"></span>
            <span id="mic-label">Mic off</span>
          </div>
          ` : `
          <div class="practice-label">Practice Mode</div>
          `}
          <button class="stop-btn" id="stop-btn">End</button>
        </div>

        ${this.mode === 'talk' ? `
        <div class="time-progress">
          <div class="time-progress-bar" id="time-progress-bar"></div>
          <span class="time-target">${targetMin} min</span>
        </div>
        ` : ''}

        <div class="live-content">
          ${blocksHtml}
          ${!this.isPractice ? `
          <div class="transcript-preview" id="transcript-box">
            <div class="transcript-label">Listening...</div>
            <div id="transcript-text"></div>
          </div>
          ` : ''}
        </div>

        ${!this.isPractice ? `
        <div class="live-actions">
          <button class="action-btn scripture-btn" id="scripture-btn" title="Lookup scripture">&#128214;</button>
          <button class="action-btn help-btn" id="help-btn" title="I need help">?</button>
        </div>
        ` : ''}

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

        <div class="time-warning" id="time-warning"></div>
      </div>
    `;

    showScreen(screenId);

    // Block navigation
    if (hasPlan) {
      const scrollEl = $('#live-plan-scroll');

      // Click to jump
      scrollEl.addEventListener('click', (e) => {
        const item = e.target.closest('.live-block-item');
        if (!item) return;
        const idx = parseInt(item.dataset.index);
        this.jumpToBlock(idx);
      });

      // Swipe detection
      let touchStartX = 0;
      let touchStartY = 0;

      scrollEl.addEventListener('touchstart', (e) => {
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      });

      scrollEl.addEventListener('touchend', (e) => {
        const touchEndX = e.changedTouches[0].clientX;
        const touchEndY = e.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
          if (diffX < 0 && this.currentBlockIndex < this.blocks.length - 1) {
            this.jumpToBlock(this.currentBlockIndex + 1);
          } else if (diffX > 0 && this.currentBlockIndex > 0) {
            this.jumpToBlock(this.currentBlockIndex - 1);
          }
        }
      });
    }

    // Practice mode - tap timer to advance
    if (this.isPractice) {
      $('#live-timer').addEventListener('click', () => {
        if (hasPlan && this.currentBlockIndex < this.blocks.length - 1) {
          this.jumpToBlock(this.currentBlockIndex + 1);
        }
      });
    }

    this.startLiveCommon();
  }

  jumpToBlock(idx) {
    if (idx < 0 || idx >= this.blocks.length) return;

    // Record time for previous block
    if (this.currentBlockIndex !== idx) {
      this.blockStartTimes[idx] = this.timerSeconds;
    }

    document.querySelectorAll('.live-block-item').forEach((el, i) => {
      el.classList.remove('active', 'past', 'skipped');
      if (i < idx) {
        el.classList.add('past');
        // Mark as skipped if jumped over
        if (i > this.currentBlockIndex) {
          el.classList.add('skipped');
        }
      }
      if (i === idx) el.classList.add('active');
    });

    this.currentBlockIndex = idx;

    const activeItem = document.querySelector(`.live-block-item[data-index="${idx}"]`);
    activeItem?.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Update block times
    this.updateBlockTimes();
  }

  updateBlockTimes() {
    this.blocks.forEach((_, i) => {
      const timeEl = $(`#block-time-${i}`);
      if (!timeEl) return;

      if (i < this.currentBlockIndex && this.blockStartTimes[i + 1] !== undefined) {
        const duration = this.blockStartTimes[i + 1] - (this.blockStartTimes[i] || 0);
        timeEl.textContent = formatTime(duration);
      } else if (i === this.currentBlockIndex) {
        const duration = this.timerSeconds - (this.blockStartTimes[i] || 0);
        timeEl.textContent = formatTime(duration);
      }
    });
  }

  startLiveCommon() {
    const targetSeconds = (this.mode === 'talk' ? this.talkDuration : 45) * 60;

    // Timer
    this.timerInterval = setInterval(() => {
      this.timerSeconds++;
      const el = $('#live-timer');
      if (el) el.textContent = formatTime(this.timerSeconds);

      // Update progress bar
      const progressBar = $('#time-progress-bar');
      if (progressBar) {
        const pct = Math.min((this.timerSeconds / targetSeconds) * 100, 100);
        progressBar.style.width = `${pct}%`;
        if (pct >= 100) progressBar.classList.add('over');
      }

      // Time warnings
      this.checkTimeWarnings(targetSeconds);

      // Update block time
      this.updateBlockTimes();
    }, 1000);

    // Stop button
    $('#stop-btn').addEventListener('click', () => {
      if (!this.isPractice) {
        this.saveCurrentSession();
      }
      this.stopLive();
      location.hash = this.mode === 'lesson' ? '#lesson-summary' : '#talk-summary';
    });

    // Dismiss suggestion
    $('#dismiss-suggestion')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hideSuggestion();
    });

    if (!this.isPractice) {
      // Scripture lookup
      $('#scripture-btn')?.addEventListener('click', async () => {
        const ref = prompt('Enter scripture reference (e.g., Alma 32:21):');
        if (!ref?.trim()) return;

        try {
          const result = await this.ai.lookupScripture(ref.trim());
          this.showSuggestion({
            type: 'scripture',
            suggestion: result.text || 'Scripture lookup',
            reference: result.reference || ref,
            bullets: []
          });
        } catch (e) {
          toast('Could not lookup scripture');
        }
      });

      // Help button
      $('#help-btn')?.addEventListener('click', async () => {
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
  }

  checkTimeWarnings(targetSeconds) {
    const remaining = targetSeconds - this.timerSeconds;
    const warningEl = $('#time-warning');
    if (!warningEl) return;

    const warnings = [
      { at: 300, msg: '5 minutes left' },
      { at: 120, msg: '2 minutes left' },
      { at: 60, msg: '1 minute left' },
      { at: 0, msg: 'Time!' }
    ];

    for (const w of warnings) {
      if (remaining <= w.at && !this.timeWarningShown[w.at]) {
        this.timeWarningShown[w.at] = true;
        warningEl.textContent = w.msg;
        warningEl.classList.add('visible');
        setTimeout(() => {
          warningEl.classList.remove('visible');
        }, 3000);
        break;
      }
    }
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
    this.isPractice = false;
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
