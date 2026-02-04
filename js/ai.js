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
   * Generate a discussion outline from user-entered title and content.
   */
  async generateLessonOutline(title, content) {
    const prompt = `You are a teaching assistant helping prepare an Elders Quorum discussion lesson.

The teacher has provided:
Title: "${title}"
Content/Notes: "${content}"

Generate a discussion outline with:
1. A brief opening thought (1-2 sentences to set the tone)
2. 4-5 discussion questions that are thought-provoking and applicable to daily life. For each question, include a relevant scripture cross-reference if applicable.
3. 2-3 key themes to emphasize

Format your response as JSON:
{
  "opening": "...",
  "questions": [
    { "question": "...", "cross_reference": "..." }
  ],
  "themes": ["...", "..."]
}

Return ONLY valid JSON, no markdown fences or extra text.`;

    const text = await this.call(prompt);
    try {
      return this._parseJSON(text);
    } catch {
      throw new Error('Failed to parse AI response. Please try again.');
    }
  }

  /**
   * Generate a talk outline from topic, scriptures, and existing content.
   */
  async generateTalkOutline(topic, scriptures, existingContent) {
    const prompt = `You are a speaking coach helping prepare a talk for an LDS church meeting.

Topic: "${topic}"
Scriptures to include: "${scriptures || 'None specified'}"
${existingContent ? `Existing draft/notes:\n"${existingContent}"` : 'No existing content yet.'}

Generate a structured talk outline with:
1. An introduction (opening hook, topic introduction)
2. 3-4 main sections, each with a key point, supporting scripture or story, and transition
3. A conclusion (testimony, call to action)
4. Estimated speaking time for each section

Format your response as JSON:
{
  "sections": [
    {
      "heading": "Introduction",
      "content": "Full text or detailed notes for this section...",
      "estimatedMinutes": 2
    },
    {
      "heading": "Section title",
      "content": "Full text or detailed notes...",
      "estimatedMinutes": 3
    }
  ],
  "totalMinutes": 12,
  "tips": ["tip1", "tip2"]
}

Return ONLY valid JSON, no markdown fences or extra text.`;

    const text = await this.call(prompt, { maxTokens: 2048 });
    try {
      return this._parseJSON(text);
    } catch {
      throw new Error('Failed to parse AI response. Please try again.');
    }
  }

  /**
   * Generate a live suggestion for lesson mode (same as before).
   */
  async generateLiveSuggestion(transcript, currentEntry, currentPoint) {
    const prompt = `You are a real-time teaching assistant for an Elders Quorum lesson.

Lesson: "${currentEntry.title}"
${currentEntry.content ? `Lesson content: "${currentEntry.content.substring(0, 500)}"` : ''}
Current Discussion Point: ${currentPoint}

Recent discussion transcript:
"${transcript}"

Based on the current discussion, suggest ONE brief, helpful thing. Choose the most appropriate:
- A follow-up question to deepen the discussion
- A relevant scripture reference that connects to what's being discussed
- A gentle redirect if the discussion has wandered far from the lesson

Format as JSON:
{
  "type": "question" | "scripture" | "redirect",
  "suggestion": "...",
  "detail": "Optional 1-sentence explanation"
}

Return ONLY valid JSON. Keep the suggestion to 1-2 sentences max.`;

    const text = await this.call(prompt, { maxTokens: 256, temperature: 0.6 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'question', suggestion: 'Consider asking the class what stood out to them from this passage.', detail: '' };
    }
  }

  /**
   * Generate a delivery suggestion during a talk (teleprompter mode).
   */
  async generateTalkDeliverySuggestion(transcript, talkContent, currentSection) {
    const prompt = `You are a real-time speaking coach for someone delivering a talk at church.

Current section of their talk: "${currentSection}"
Their full talk content (abbreviated): "${talkContent.substring(0, 800)}"

Recent transcript of what they've been saying:
"${transcript}"

Give ONE brief delivery suggestion. Choose the most helpful:
- Pacing advice (slow down, pause here, etc.)
- Transition suggestion to the next point
- Emphasis tip (a phrase to stress, eye contact reminder)
- Encouragement if they seem to be doing well

Format as JSON:
{
  "type": "pacing" | "transition" | "emphasis" | "encouragement",
  "suggestion": "...",
  "detail": "Optional brief explanation"
}

Return ONLY valid JSON. Keep it to 1-2 sentences.`;

    const text = await this.call(prompt, { maxTokens: 256, temperature: 0.6 });
    try {
      return this._parseJSON(text);
    } catch {
      return { type: 'encouragement', suggestion: 'You\'re doing great. Remember to make eye contact and speak slowly.', detail: '' };
    }
  }

  /**
   * Generate a post-lesson summary.
   */
  async generateLessonSummary(title, transcript, coveredPoints, totalPoints, durationMinutes) {
    const prompt = `You are a teaching assistant summarizing an Elders Quorum lesson.

Lesson: "${title}"
Duration: ${durationMinutes} minutes
Points covered: ${coveredPoints} of ${totalPoints}

Full discussion transcript:
"${transcript}"

Generate a brief post-lesson summary:
1. Main themes discussed (2-3 bullet points)
2. Key insights from the discussion
3. 1-2 suggestions for follow-up next week

Format as JSON:
{
  "themes": ["...", "..."],
  "insights": "...",
  "followUp": ["...", "..."]
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 512 });
    try {
      return this._parseJSON(text);
    } catch {
      return { themes: ['Discussion summary unavailable'], insights: '', followUp: [] };
    }
  }

  /**
   * Generate a post-talk delivery assessment.
   */
  async generateTalkSummary(topic, transcript, durationMinutes) {
    const prompt = `You are a speaking coach reviewing a church talk that was just delivered.

Topic: "${topic}"
Duration: ${durationMinutes} minutes

Full transcript of the talk:
"${transcript}"

Generate a delivery assessment:
1. Overall assessment (1-2 sentences)
2. 2-3 strengths observed
3. 2-3 areas for improvement
4. Encouragement note

Format as JSON:
{
  "assessment": "...",
  "strengths": ["...", "..."],
  "improvements": ["...", "..."],
  "encouragement": "..."
}

Return ONLY valid JSON.`;

    const text = await this.call(prompt, { maxTokens: 512 });
    try {
      return this._parseJSON(text);
    } catch {
      return { assessment: 'Summary unavailable', strengths: [], improvements: [], encouragement: '' };
    }
  }

  /**
   * Transcribe audio and generate a live suggestion in one call.
   * mode: 'lesson' | 'talk'
   */
  async transcribeAndSuggest(base64Audio, mimeType, currentEntry, currentPoint, mode = 'lesson') {
    const key = this.getApiKey();
    if (!key) throw new Error('No API key configured');

    const contextInfo = mode === 'lesson'
      ? `Lesson: "${currentEntry.title}"\nCurrent Discussion Point: ${currentPoint}`
      : `Talk topic: "${currentEntry.topic}"\nCurrent section: ${currentPoint}`;

    const suggestionInstruction = mode === 'lesson'
      ? 'A follow-up question, a relevant scripture, or a gentle redirect if off-topic.'
      : 'A pacing tip, transition suggestion, emphasis advice, or encouragement.';

    const typeOptions = mode === 'lesson'
      ? '"question" | "scripture" | "redirect"'
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
            text: `You are a real-time assistant.

${contextInfo}

First, transcribe the audio. Then, based on the discussion, suggest ONE helpful thing:
- ${suggestionInstruction}

Format as JSON:
{
  "transcript": "what was said in the audio",
  "type": ${typeOptions},
  "suggestion": "your suggestion",
  "detail": "optional 1-sentence explanation"
}

If the audio is silent or unintelligible, set transcript to "" and suggestion to "".
Return ONLY valid JSON.`
          }
        ]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 512
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
      return { transcript: '', type: 'question', suggestion: '', detail: '' };
    }
  }

  /**
   * Validate API key by making a minimal request.
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
