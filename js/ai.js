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
   * Fetch and parse content from a URL (conference talk, etc.)
   */
  async fetchUrlContent(url) {
    const prompt = `Fetch and summarize the content from this URL for lesson/talk preparation.

URL: ${url}

If this is a church talk or lesson material, extract:
1. The title
2. The speaker/author (if applicable)
3. The main content/text

Format as JSON:
{
  "title": "Talk or lesson title",
  "author": "Speaker name or empty string",
  "content": "The main text content, summarized if very long (keep under 2000 chars)",
  "success": true
}

If you cannot access or parse the URL, return:
{
  "title": "",
  "author": "",
  "content": "",
  "success": false,
  "error": "Reason for failure"
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 2500 });
    try {
      return this._parseJSON(text);
    } catch {
      return { success: false, error: 'Failed to parse response' };
    }
  }

  /**
   * Chat-based collaborative planning for lessons.
   */
  async chatPlanLesson(message, currentBlocks, context) {
    const blocksJson = JSON.stringify(currentBlocks, null, 2);

    const prompt = `You are a collaborative lesson planning assistant for LDS Elders Quorum lessons.

Current lesson context:
- Title: "${context.title || 'Untitled'}"
- Content/Notes: "${context.content || 'None yet'}"

Current outline blocks:
${currentBlocks.length > 0 ? blocksJson : 'No blocks yet.'}

User's message: "${message}"

Respond conversationally AND update the blocks if needed. Your response format:
{
  "reply": "Your conversational response to the user (1-3 sentences)",
  "blocks": [
    { "type": "point", "content": "...", "detail": "..." },
    { "type": "scripture", "content": "Reference", "detail": "Context" },
    { "type": "question", "content": "...", "detail": "" }
  ],
  "blocksChanged": true or false
}

Block types: point, scripture, question, quote, note

Guidelines:
- If user asks to add/remove/change blocks, do it and set blocksChanged: true
- If user just asks a question or chats, reply helpfully and return existing blocks with blocksChanged: false
- Keep blocks concise (1-2 sentences each)
- Be helpful and collaborative, not formal

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 1500 });
    try {
      return this._parseJSON(text);
    } catch {
      return {
        reply: "I had trouble processing that. Could you try rephrasing?",
        blocks: currentBlocks,
        blocksChanged: false
      };
    }
  }

  /**
   * Chat-based collaborative planning for talks.
   */
  async chatPlanTalk(message, currentBlocks, context) {
    const blocksJson = JSON.stringify(currentBlocks, null, 2);

    const prompt = `You are a collaborative talk planning assistant for LDS church talks.

Current talk context:
- Topic: "${context.topic || 'Untitled'}"
- Scriptures: "${context.scriptures || 'None specified'}"
- Duration: ${context.duration || 10} minutes
- Notes: "${context.content || 'None yet'}"

Current outline blocks:
${currentBlocks.length > 0 ? blocksJson : 'No blocks yet.'}

User's message: "${message}"

Respond conversationally AND update the blocks if needed. Your response format:
{
  "reply": "Your conversational response (1-3 sentences)",
  "blocks": [
    { "type": "point", "content": "...", "detail": "..." },
    { "type": "scripture", "content": "Reference", "detail": "Context" }
  ],
  "blocksChanged": true or false
}

Block types: point, scripture, question, quote, note

Guidelines:
- If user asks to add/remove/change blocks, do it and set blocksChanged: true
- Keep the talk appropriately sized for ${context.duration || 10} minutes
- Be helpful and encouraging
- Keep blocks concise

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 1500 });
    try {
      return this._parseJSON(text);
    } catch {
      return {
        reply: "I had trouble processing that. Could you try rephrasing?",
        blocks: currentBlocks,
        blocksChanged: false
      };
    }
  }

  /**
   * Generate initial blocks for lesson (used when user wants quick generation).
   */
  async generateLessonBlocks(title, content) {
    const prompt = `You are a teaching assistant helping prepare an Elders Quorum discussion lesson.

Title: "${title}"
Content/Notes: "${content}"

Generate a lesson outline as blocks. Include a MIX of:
- point: Key ideas to discuss
- scripture: Relevant scripture references
- question: Discussion questions
- quote: Conference talk quotes (optional)

Format as JSON:
{
  "blocks": [
    { "type": "point", "content": "Main idea", "detail": "Supporting detail" },
    { "type": "scripture", "content": "Alma 32:21", "detail": "Faith is not a perfect knowledge" },
    { "type": "question", "content": "Discussion question?", "detail": "" }
  ]
}

Generate 5-8 blocks. Keep each concise. Return ONLY valid JSON.`;

    const text = await this.call(prompt);
    try {
      return this._parseJSON(text);
    } catch {
      throw new Error('Failed to parse AI response. Please try again.');
    }
  }

  /**
   * Generate initial blocks for talk.
   */
  async generateTalkBlocks(topic, scriptures, existingContent, durationMinutes) {
    const prompt = `You are a speaking coach helping prepare a ${durationMinutes}-minute talk.

Topic: "${topic}"
Scriptures: "${scriptures || 'None specified'}"
Notes: "${existingContent || 'None'}"

Generate a talk outline as blocks for ${durationMinutes} minutes (~${Math.ceil(durationMinutes / 2)} blocks).

Format as JSON:
{
  "blocks": [
    { "type": "point", "content": "Opening/intro", "detail": "Hook or story" },
    { "type": "scripture", "content": "Reference", "detail": "Key verse" },
    { "type": "point", "content": "Main point", "detail": "Explanation" },
    { "type": "note", "content": "Bear testimony", "detail": "" }
  ],
  "estimatedMinutes": ${durationMinutes}
}

Keep blocks concise. Return ONLY valid JSON.`;

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
      ? 'Free-form gospel discussion.'
      : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent topic: ${currentBlock || 'Open discussion'}`;

    const prompt = `You are a real-time teaching assistant for an LDS Elders Quorum lesson.

${contextInfo}

Recent discussion (last 15 seconds):
"${transcript}"

Provide ONE helpful suggestion:
1. **scripture** - Identify a referenced story/scripture
2. **doctrine** - Answer a hard question + pivot back
3. **question** - Follow-up question
4. **redirect** - Gentle refocus

Format as JSON:
{
  "type": "scripture" | "doctrine" | "question" | "redirect",
  "suggestion": "Main point (1 line)",
  "bullets": ["bullet 1", "bullet 2"],
  "reference": "Source if applicable"
}

Max 2 bullets. Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 300, temperature: 0.6 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'question', suggestion: 'What has stood out to you?', bullets: [], reference: '' };
    }
  }

  /**
   * Generate immediate help.
   */
  async generateImmediateHelp(transcript, currentEntry, currentBlock, hasNoPlan = false) {
    const contextInfo = hasNoPlan
      ? 'Free-form gospel discussion.'
      : `Lesson: "${currentEntry?.title || 'Discussion'}"\nTopic: ${currentBlock || 'Open'}`;

    const prompt = `Help a Sunday School teacher who pressed "I need help".

${contextInfo}

Recent discussion:
"${transcript}"

Provide immediate, actionable help:
{
  "type": "help",
  "suggestion": "What to do right now",
  "bullets": ["action 1", "action 2"],
  "reference": "Scripture if applicable"
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 250, temperature: 0.7 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'help', suggestion: 'Ask: "What questions do you have?"', bullets: [], reference: '' };
    }
  }

  /**
   * Generate a delivery suggestion during a talk.
   */
  async generateTalkDeliverySuggestion(transcript, talkContent, currentSection) {
    const prompt = `Speaking coach for a church talk.

Current section: "${currentSection}"
Talk: "${talkContent.substring(0, 600)}"

Recent transcript:
"${transcript}"

Give ONE delivery tip:
{
  "type": "pacing" | "transition" | "emphasis" | "encouragement",
  "suggestion": "Main advice",
  "bullets": ["tip"]
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 200, temperature: 0.6 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'encouragement', suggestion: 'You\'re doing great.', bullets: [] };
    }
  }

  /**
   * Generate lesson summary.
   */
  async generateLessonSummary(title, transcript, coveredBlocks, totalBlocks, durationMinutes) {
    const prompt = `Summarize this Elders Quorum lesson.

Lesson: "${title || 'Discussion'}"
Duration: ${durationMinutes} min
Blocks: ${coveredBlocks}/${totalBlocks}

Transcript:
"${transcript}"

Format:
{
  "themes": ["theme 1", "theme 2"],
  "insights": "Key insight",
  "followUp": ["suggestion"]
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
   * Generate talk summary.
   */
  async generateTalkSummary(topic, transcript, durationMinutes) {
    const prompt = `Review this church talk.

Topic: "${topic}"
Duration: ${durationMinutes} min

Transcript:
"${transcript}"

Format:
{
  "assessment": "Overall (1-2 sentences)",
  "strengths": ["strength 1"],
  "improvements": ["area 1"],
  "encouragement": "Note"
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
   * Transcribe audio and suggest.
   */
  async transcribeAndSuggest(base64Audio, mimeType, currentEntry, currentBlock, mode = 'lesson', hasNoPlan = false) {
    const key = this.getApiKey();
    if (!key) throw new Error('No API key configured');

    const contextInfo = mode === 'lesson'
      ? (hasNoPlan ? 'Free-form discussion.' : `Lesson: "${currentEntry?.title}"\nTopic: ${currentBlock}`)
      : `Talk: "${currentEntry?.topic}"\nSection: ${currentBlock}`;

    const suggestionTypes = mode === 'lesson'
      ? '"scripture" | "doctrine" | "question" | "redirect"'
      : '"pacing" | "transition" | "emphasis" | "encouragement"';

    const url = `${this.baseUrl}/${this.model}:generateContent?key=${key}`;
    const body = {
      contents: [{
        parts: [
          { inlineData: { mimeType, data: base64Audio } },
          {
            text: `Real-time assistant.

${contextInfo}

Transcribe audio, then suggest:
{
  "transcript": "what was said",
  "type": ${suggestionTypes},
  "suggestion": "Main point",
  "bullets": ["bullet"],
  "reference": "Source"
}

If silent, return empty strings. Return ONLY valid JSON.`
          }
        ]
      }],
      generationConfig: { temperature: 0.6, maxOutputTokens: 350 }
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
      contents: [{ parts: [{ text: 'Reply "ok"' }] }],
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
