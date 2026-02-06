/**
 * Gemini API integration for lesson/talk preparation, live suggestions, and summaries.
 */
export class AI {
  constructor() {
    this.model = 'gemini-2.0-flash';
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  getApiKey() {
    return localStorage.getItem('gemini_api_key') || '';
  }

  hasApiKey() {
    return this.getApiKey().length > 0;
  }

  async call(prompt, options = {}) {
    const key = this.getApiKey();
    if (!key) throw new Error('No API key configured');

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${key}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: options.temperature ?? 0.7,
        maxOutputTokens: options.maxTokens ?? 1024
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error: ${res.status}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  _parseJSON(text) {
    const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  }

  /**
   * Generate flexible blocks for lesson planning.
   * Returns mix of points, scriptures, questions, quotes.
   */
  async generateLessonBlocks(title, content) {
    const prompt = `You are a teaching assistant helping prepare an Elders Quorum discussion lesson.

The teacher has provided:
Title: "${title}"
Content/Notes: "${content}"

Generate a lesson outline as flexible blocks. Include a MIX of:
- point: Key ideas to discuss (most important)
- scripture: Relevant scripture references with brief context
- question: Discussion questions
- quote: Relevant conference talk quotes (optional)

Format as JSON:
{
  "blocks": [
    { "type": "point", "content": "Main idea here", "detail": "Optional supporting detail" },
    { "type": "scripture", "content": "Alma 32:21", "detail": "Faith is not a perfect knowledge" },
    { "type": "question", "content": "How can we apply this?", "detail": "" },
    { "type": "quote", "content": "Quote text here", "detail": "Speaker name, talk title" }
  ]
}

Guidelines:
- Generate 5-8 blocks total
- Start with a key point, mix in scriptures and questions throughout
- Make it practical and applicable to daily life
- Keep each block concise (1-2 sentences max)

Return ONLY valid JSON.`;

    const text = await this.call(prompt);
    try {
      return this._parseJSON(text);
    } catch {
      throw new Error('Failed to parse AI response. Please try again.');
    }
  }

  /**
   * Generate talk outline with duration awareness.
   */
  async generateTalkBlocks(topic, scriptures, existingContent, durationMinutes) {
    const prompt = `You are a speaking coach helping prepare a ${durationMinutes}-minute talk for an LDS church meeting.

Topic: "${topic}"
Scriptures to include: "${scriptures || 'None specified'}"
${existingContent ? `Existing draft/notes:\n"${existingContent}"` : 'No existing content yet.'}

Generate a talk outline as blocks that fits in ${durationMinutes} minutes. Include:
- point: Main ideas and talking points
- scripture: Scripture references to read or cite
- quote: Conference talk quotes (optional)
- note: Personal reminders or transitions

Format as JSON:
{
  "blocks": [
    { "type": "point", "content": "Opening hook or story", "detail": "Introduce the topic" },
    { "type": "scripture", "content": "Scripture reference", "detail": "Key verse text or context" },
    { "type": "point", "content": "Main point", "detail": "Supporting explanation" },
    { "type": "note", "content": "Bear testimony here", "detail": "" }
  ],
  "estimatedMinutes": ${durationMinutes}
}

Guidelines:
- For ${durationMinutes} min talk: ~${Math.ceil(durationMinutes / 2)} blocks
- Include intro, 2-3 main points, and conclusion
- Keep blocks concise - these are prompts, not full paragraphs
- End with testimony/call to action

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 1500 });
    try {
      return this._parseJSON(text);
    } catch {
      throw new Error('Failed to parse AI response. Please try again.');
    }
  }

  /**
   * Generate a live suggestion for lesson mode.
   */
  async generateLiveSuggestion(transcript, currentEntry, currentBlock, hasNoPlan = false) {
    const contextInfo = hasNoPlan
      ? 'Free-form gospel discussion with no specific lesson plan.'
      : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent topic: ${currentBlock || 'Open discussion'}`;

    const prompt = `You are a real-time teaching assistant for an LDS Elders Quorum lesson. You have deep knowledge of LDS scriptures, General Conference talks, handbooks, and gospel doctrine.

${contextInfo}

Recent discussion (last 15 seconds):
"${transcript}"

Provide ONE helpful suggestion. Choose the most appropriate:

1. **scripture** - Someone mentioned a story/scripture but can't place it? Identify the reference.
2. **doctrine** - Hard doctrinal question? Brief answer from official sources + pivot back to lesson.
3. **question** - Good follow-up question to deepen discussion.
4. **redirect** - Discussion wandered? Gentle way to refocus.

Format as JSON:
{
  "type": "scripture" | "doctrine" | "question" | "redirect",
  "suggestion": "Main point (1 line)",
  "bullets": ["bullet 1", "bullet 2"],
  "reference": "Scripture or source if applicable"
}

RULES:
- Max 2 short bullets
- Keep it scannable, no paragraphs
- Return ONLY valid JSON`;

    const text = await this.call(prompt, { maxTokens: 300, temperature: 0.6 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'question', suggestion: 'What has stood out to you from this discussion?', bullets: [], reference: '' };
    }
  }

  /**
   * Generate immediate help when user taps "I need help" button.
   */
  async generateImmediateHelp(transcript, currentEntry, currentBlock, hasNoPlan = false) {
    const contextInfo = hasNoPlan
      ? 'Free-form gospel discussion, no lesson plan.'
      : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent topic: ${currentBlock || 'Open discussion'}`;

    const prompt = `You are helping a Sunday School teacher who just pressed "I need help" during their lesson.

${contextInfo}

What they've been discussing:
"${transcript}"

The teacher needs immediate, actionable help. Provide ONE of:
1. A question to restart stalled discussion
2. A relevant scripture to share
3. A story or example to illustrate the point
4. A way to transition to the next topic

Format as JSON:
{
  "type": "help",
  "suggestion": "What to do right now (1 line)",
  "bullets": ["specific action or talking point", "optional second point"],
  "reference": "Scripture reference if applicable"
}

Keep it brief and immediately actionable. Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 250, temperature: 0.7 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'help', suggestion: 'Ask: "What questions do you have about what we\'ve discussed?"', bullets: [], reference: '' };
    }
  }

  /**
   * Generate a delivery suggestion during a talk.
   */
  async generateTalkDeliverySuggestion(transcript, talkContent, currentSection) {
    const prompt = `You are a real-time speaking coach for someone delivering a talk at church.

Current section: "${currentSection}"
Talk content (abbreviated): "${talkContent.substring(0, 600)}"

Recent transcript:
"${transcript}"

Give ONE brief delivery suggestion:
- Pacing (slow down, pause)
- Transition to next point
- Emphasis tip
- Encouragement

Format as JSON:
{
  "type": "pacing" | "transition" | "emphasis" | "encouragement",
  "suggestion": "Main advice (1 line)",
  "bullets": ["specific tip"]
}

Max 2 bullets. Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 200, temperature: 0.6 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'encouragement', suggestion: 'You\'re doing great. Make eye contact and breathe.', bullets: [] };
    }
  }

  /**
   * Generate a post-lesson summary.
   */
  async generateLessonSummary(title, transcript, coveredBlocks, totalBlocks, durationMinutes) {
    const prompt = `Summarize this Elders Quorum lesson.

Lesson: "${title || 'Gospel Discussion'}"
Duration: ${durationMinutes} minutes
Blocks covered: ${coveredBlocks} of ${totalBlocks}

Transcript:
"${transcript}"

Format as JSON:
{
  "themes": ["theme 1", "theme 2"],
  "insights": "Key insight from discussion",
  "followUp": ["suggestion for next week"]
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 400 });
    try {
      return this._parseJSON(text);
    } catch {
      return { themes: ['Summary unavailable'], insights: '', followUp: [] };
    }
  }

  /**
   * Generate a post-talk delivery assessment.
   */
  async generateTalkSummary(topic, transcript, durationMinutes) {
    const prompt = `Review this church talk delivery.

Topic: "${topic}"
Duration: ${durationMinutes} minutes

Transcript:
"${transcript}"

Format as JSON:
{
  "assessment": "Overall assessment (1-2 sentences)",
  "strengths": ["strength 1", "strength 2"],
  "improvements": ["area 1", "area 2"],
  "encouragement": "Encouraging note"
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 400 });
    try {
      return this._parseJSON(text);
    } catch {
      return { assessment: 'Summary unavailable', strengths: [], improvements: [], encouragement: '' };
    }
  }

  /**
   * Transcribe audio and generate a live suggestion in one call.
   */
  async transcribeAndSuggest(base64Audio, mimeType, currentEntry, currentBlock, mode = 'lesson', hasNoPlan = false) {
    const key = this.getApiKey();
    if (!key) throw new Error('No API key configured');

    const contextInfo = mode === 'lesson'
      ? (hasNoPlan
          ? 'Free-form gospel discussion.'
          : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent topic: ${currentBlock}`)
      : `Talk: "${currentEntry?.topic || 'Gospel Talk'}"\nCurrent section: ${currentBlock}`;

    const suggestionTypes = mode === 'lesson'
      ? '"scripture" | "doctrine" | "question" | "redirect"'
      : '"pacing" | "transition" | "emphasis" | "encouragement"';

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${key}`;
    const body = {
      contents: [{
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Audio
            }
          },
          {
            text: `You are a real-time assistant with LDS gospel knowledge.

${contextInfo}

Transcribe the audio, then suggest ONE helpful thing.

Format as JSON:
{
  "transcript": "what was said",
  "type": ${suggestionTypes},
  "suggestion": "Main point (1 line)",
  "bullets": ["bullet 1"],
  "reference": "Source if applicable"
}

Max 2 bullets. If audio is silent, set transcript and suggestion to "".
Return ONLY valid JSON.`
          }
        ]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 350
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API error: ${res.status}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try {
      return this._parseJSON(text);
    } catch {
      return { transcript: '', type: 'question', suggestion: '', bullets: [], reference: '' };
    }
  }

  /**
   * Validate API key.
   */
  async validateKey(key) {
    const url = `${this.baseUrl}/${this.model}:generateContent?key=${key}`;
    const body = {
      contents: [{ parts: [{ text: 'Reply with the word "ok"' }] }],
      generationConfig: { maxOutputTokens: 8 }
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
