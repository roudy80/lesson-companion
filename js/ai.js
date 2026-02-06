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
   * Generate a live suggestion for lesson mode.
   * Now includes scripture spotlight and doctrine pivot capabilities.
   */
  async generateLiveSuggestion(transcript, currentEntry, currentPoint, hasNoPlan = false) {
    const contextInfo = hasNoPlan
      ? 'This is a free-form gospel discussion with no specific lesson plan.'
      : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent Discussion Point: ${currentPoint || 'Open discussion'}`;

    const prompt = `You are a real-time teaching assistant for an LDS Elders Quorum lesson. You have deep knowledge of LDS scriptures, General Conference talks, handbooks, and gospel doctrine.

${contextInfo}

Recent discussion transcript (last 15 seconds):
"${transcript}"

Analyze the discussion and provide ONE of these responses (choose the most helpful):

1. **scripture** - If someone mentions a story, principle, or scripture but can't remember the reference, identify it
2. **doctrine** - If a hard doctrinal question was asked, provide a brief answer from official sources + a pivot back to the lesson
3. **question** - A follow-up question to deepen the discussion
4. **redirect** - If discussion has wandered, a gentle way to refocus

Format as JSON:
{
  "type": "scripture" | "doctrine" | "question" | "redirect",
  "suggestion": "Main point (1 line max)",
  "bullets": ["bullet 1", "bullet 2"],
  "reference": "Scripture or handbook reference if applicable"
}

RULES:
- Max 2-3 short bullets
- No paragraphs, keep it scannable
- For scripture type: identify the exact reference
- For doctrine type: cite handbook/scripture, then pivot suggestion
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
  async generateImmediateHelp(transcript, currentEntry, currentPoint, hasNoPlan = false) {
    const contextInfo = hasNoPlan
      ? 'Free-form gospel discussion, no lesson plan.'
      : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent point: ${currentPoint || 'Open discussion'}`;

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
  "suggestion": "Main advice (1 line)",
  "bullets": ["specific tip"]
}

Max 2 bullets. Keep it scannable. Return ONLY valid JSON.`;

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
  async generateLessonSummary(title, transcript, coveredPoints, totalPoints, durationMinutes) {
    const prompt = `You are a teaching assistant summarizing an Elders Quorum lesson.

Lesson: "${title || 'Gospel Discussion'}"
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
  async transcribeAndSuggest(base64Audio, mimeType, currentEntry, currentPoint, mode = 'lesson', hasNoPlan = false) {
    const key = this.getApiKey();
    if (!key) throw new Error('No API key configured');

    const contextInfo = mode === 'lesson'
      ? (hasNoPlan
          ? 'Free-form gospel discussion, no lesson plan.'
          : `Lesson: "${currentEntry?.title || 'Gospel Discussion'}"\nCurrent Discussion Point: ${currentPoint}`)
      : `Talk topic: "${currentEntry?.topic || 'Gospel Talk'}"\nCurrent section: ${currentPoint}`;

    const suggestionTypes = mode === 'lesson'
      ? '"scripture" | "doctrine" | "question" | "redirect"'
      : '"pacing" | "transition" | "emphasis" | "encouragement"';

    const suggestionInstruction = mode === 'lesson'
      ? `Choose ONE:
- scripture: If someone mentions a story/scripture but can't place it, identify the reference
- doctrine: For hard doctrinal questions, brief answer + pivot back to lesson
- question: Follow-up question to deepen discussion
- redirect: Gentle refocus if off-topic`
      : 'A pacing tip, transition suggestion, emphasis advice, or encouragement.';

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
            text: `You are a real-time assistant with deep LDS gospel knowledge.

${contextInfo}

First, transcribe the audio. Then provide a suggestion.
${suggestionInstruction}

Format as JSON:
{
  "transcript": "what was said in the audio",
  "type": ${suggestionTypes},
  "suggestion": "Main point (1 line max)",
  "bullets": ["bullet 1", "bullet 2"],
  "reference": "Scripture/handbook reference if applicable"
}

Max 2-3 short bullets. If audio is silent/unintelligible, set transcript and suggestion to "".
Return ONLY valid JSON.`
          }
        ]
      }],
      generationConfig: {
        temperature: 0.6,
        maxOutputTokens: 400
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
