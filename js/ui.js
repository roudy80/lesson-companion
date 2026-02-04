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
 * Determine current week's lesson from date.
 */
export function getCurrentWeek(lessons) {
  const now = new Date();
  const month = now.getMonth(); // 0-indexed
  const day = now.getDate();

  // Parse date ranges to find the current lesson
  for (const lesson of lessons) {
    const range = parseDateRange(lesson.date_range, 2025);
    if (range && now >= range.start && now <= range.end) {
      return lesson;
    }
  }

  // Fallback: return the first lesson
  return lessons[0] || null;
}

function parseDateRange(rangeStr, year) {
  // Formats: "February 3-9" or "February 24 - March 2"
  try {
    const months = {
      'January': 0, 'February': 1, 'March': 2, 'April': 3,
      'May': 4, 'June': 5, 'July': 6, 'August': 7,
      'September': 8, 'October': 9, 'November': 10, 'December': 11
    };

    const parts = rangeStr.split('-').map(s => s.trim());
    if (parts.length !== 2) return null;

    // Parse start
    const startParts = parts[0].split(/\s+/);
    const startMonth = months[startParts[0]];
    const startDay = parseInt(startParts[1]);

    // Parse end - might have a month or just a day
    const endParts = parts[1].split(/\s+/).filter(Boolean);
    let endMonth, endDay;
    if (endParts.length >= 2) {
      endMonth = months[endParts[0]];
      endDay = parseInt(endParts[1]);
    } else {
      endMonth = startMonth;
      endDay = parseInt(endParts[0]);
    }

    if (isNaN(startDay) || isNaN(endDay)) return null;

    return {
      start: new Date(year, startMonth, startDay),
      end: new Date(year, endMonth, endDay, 23, 59, 59)
    };
  } catch {
    return null;
  }
}

/**
 * Render a lesson card for the home list.
 */
export function renderLessonItem(lesson, isCurrent, onClick) {
  const item = document.createElement('li');
  item.className = 'lesson-item';
  if (isCurrent) item.style.borderColor = 'var(--gold-dim)';
  item.innerHTML = `
    <span class="week-num">W${lesson.week}</span>
    <div class="lesson-info">
      <div class="lesson-title">${lesson.title}</div>
      <div class="lesson-date">${lesson.date_range} &middot; ${lesson.scripture_block}</div>
    </div>
    <span class="arrow">&rsaquo;</span>
  `;
  item.addEventListener('click', () => onClick(lesson));
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
