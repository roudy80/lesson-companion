/**
 * DOM rendering helpers.
 */

export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}

export function show(el) {
  if (typeof el === 'string') el = $(el);
  el?.classList.remove('hidden');
}

export function hide(el) {
  if (typeof el === 'string') el = $(el);
  el?.classList.add('hidden');
}

/**
 * Switch to a screen by id.
 */
export function showScreen(screenId) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const screen = $(`#${screenId}`);
  if (screen) screen.classList.add('active');
}

/**
 * Show a toast notification.
 */
let toastTimer = null;
export function toast(message, durationMs = 3000) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), durationMs);
}

/**
 * Format seconds as mm:ss.
 */
export function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Render a past session item (lesson or talk) for the tab lists.
 */
export function renderSessionItem(entry, type, onClick) {
  const item = document.createElement('li');
  item.className = 'session-item';

  const dateStr = new Date(entry.createdAt).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });

  const title = type === 'lesson' ? entry.title : entry.topic;
  const meta = type === 'lesson'
    ? (entry.content ? entry.content.substring(0, 60) + '...' : dateStr)
    : (entry.scriptures || dateStr);

  const durationStr = entry.duration
    ? `${Math.floor(entry.duration / 60)}m`
    : '';

  item.innerHTML = `
    <div class="session-info">
      <div class="session-title">${title}</div>
      <div class="session-meta">${dateStr}${durationStr ? ' &middot; ' + durationStr : ''}</div>
    </div>
    <span class="arrow">&rsaquo;</span>
  `;
  item.addEventListener('click', () => onClick(entry));
  return item;
}

/**
 * Render a question item for prep/edit.
 */
export function renderQuestionItem(q) {
  const item = document.createElement('li');
  item.className = 'question-item';
  item.innerHTML = `
    <div class="question-text">${q.question}</div>
    ${q.cross_reference ? `<div class="cross-ref">${q.cross_reference}</div>` : ''}
  `;
  return item;
}
