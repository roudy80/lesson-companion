/**
 * Gemini API integration for lesson preparation and live suggestions.
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

  /**
   * Generate a discussion outline for lesson prep.
   */
  async generatePrepOutline(lesson) {
    const prompt = `You are a teaching assistant helping prepare an LDS Elders Quorum lesson using Come, Follow Me curriculum.

Lesson: "${lesson.title}"
Scripture Block: ${lesson.scripture_block}
Key Topics: ${lesson.topics.join(', ')}
Key Verses: ${lesson.key_verses.join(', ')}

Generate a discussion outline with:
1. A brief opening thought (1-2 sentences to set the tone)
2. 4-5 discussion questions that are thought-provoking and applicable to daily life. For each question, include a relevant scripture cross-reference.
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
      // Strip markdown code fences if present
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      throw new Error('Failed to parse AI response. Please try again.');
    }
  }

  /**
   * Generate a live suggestion based on transcript and lesson context.
   */
  async generateLiveSuggestion(transcript, lessonContext, currentPoint) {
    const prompt = `You are a real-time teaching assistant for an LDS Elders Quorum lesson.

Lesson: "${lessonContext.title}"
Scripture Block: ${lessonContext.scripture_block}
Current Discussion Point: ${currentPoint}
Key Topics for this lesson: ${lessonContext.topics.join(', ')}

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
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { type: 'question', suggestion: 'Consider asking the class what stood out to them from this passage.', detail: '' };
    }
  }

  /**
   * Generate a post-lesson summary.
   */
  async generateSummary(lesson, transcript, coveredPoints, totalPoints, durationMinutes) {
    const prompt = `You are a teaching assistant summarizing an LDS Elders Quorum lesson.

Lesson: "${lesson.title}"
Scripture Block: ${lesson.scripture_block}
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
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      return { themes: ['Discussion summary unavailable'], insights: '', followUp: [] };
    }
  }

  /**
   * Transcribe audio and generate a live suggestion in one call.
   * Used as fallback on browsers without Web Speech API (iOS Safari).
   */
  async transcribeAndSuggest(base64Audio, mimeType, lessonContext, currentPoint) {
    const key = this.getApiKey();
    if (!key) throw new Error('No API key configured');

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
            text: `You are a real-time teaching assistant for an LDS Elders Quorum lesson.

Lesson: "${lessonContext.title}"
Scripture Block: ${lessonContext.scripture_block}
Current Discussion Point: ${currentPoint}

First, transcribe the audio. Then, based on the discussion, suggest ONE helpful thing:
- A follow-up question, a relevant scripture, or a gentle redirect if off-topic.

Format as JSON:
{
  "transcript": "what was said in the audio",
  "type": "question" | "scripture" | "redirect",
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
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
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
