import type { TemplateBrief } from './brief';

/**
 * Input schemas (required values) for the education templates. Each brief's
 * `slug` matches the blank template's slug in `slides-education.ts`; a fill
 * agent collects these values and drops them into the template's placeholder
 * slots.
 */

export const seminarDeckBrief: TemplateBrief = {
  slug: 'seminar-deck',
  summary: 'A seminar or talk: the topic, its core content, and the key takeaways.',
  fields: [
    { key: 'speaker', label: 'Speaker', type: 'text', example: 'Dr. Lee' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'topic', label: "Today's topic (question, why it matters, takeaway)", type: 'list', min: 3, max: 3, example: 'The question this seminar answers' },
    { key: 'coreContent', label: 'Core content — the key ideas and how they fit', type: 'list', min: 4, max: 4, example: 'The first key idea' },
    { key: 'takeaways', label: 'Key takeaways', type: 'list', min: 3, max: 3, example: 'The one thing to remember' },
  ],
};

export const universityLectureBrief: TemplateBrief = {
  slug: 'university-lecture',
  summary: 'A lecture: objectives, a core concept, a worked example, mistakes vs the right approach.',
  fields: [
    { key: 'course', label: 'Course', type: 'text', example: 'Astrophysics 201' },
    { key: 'lectureNumber', label: 'Lecture number', type: 'text', example: '5' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'objectives', label: 'Learning objectives', type: 'list', min: 3, max: 3, example: 'By the end you will be able to derive the orbit equation' },
    { key: 'concept', label: 'Core concept in one sentence', type: 'line', example: 'Angular momentum is conserved when no external torque acts.' },
    { key: 'workedExample', label: 'Worked example (problem, reasoning, result)', type: 'list', min: 3, max: 3, example: 'The problem to solve' },
    { key: 'mistakesVsRight', label: 'Common mistakes vs the right approach', type: 'pairs', pair: ['Common mistake', 'The right approach'], min: 3, max: 3, example: 'Skipping the base case → Handle the base case first' },
    { key: 'summary', label: 'Summary (concept, example, pitfall)', type: 'list', min: 3, max: 3, example: 'The concept, restated' },
    { key: 'reference', label: 'Further reading', type: 'text', example: 'Griffiths, ch. 4' },
  ],
};

export const studentPresentationBrief: TemplateBrief = {
  slug: 'student-presentation',
  summary: 'A class or assignment presentation: topic and question, what you did, the result, what you learned.',
  fields: [
    { key: 'name', label: 'Name', type: 'text', example: 'Minji Kim' },
    { key: 'course', label: 'Course', type: 'text', example: 'Data Structures' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'topicAndQuestion', label: 'Topic and question (topic, question, why it interested you)', type: 'list', min: 3, max: 3, example: 'The topic I chose' },
    { key: 'whatIDid', label: 'What I did (approach, what I tested, what I left out)', type: 'list', min: 3, max: 3, example: 'How I approached it' },
    { key: 'keyResult', label: 'The key result, in one number', type: 'metric', example: '27% · faster than the baseline' },
    { key: 'whatILearned', label: 'What I learned', type: 'list', min: 3, max: 3, example: 'What the result tells us' },
  ],
};

export const workshopTrainingBrief: TemplateBrief = {
  slug: 'workshop-training',
  summary: 'A hands-on session: what people will learn, the agenda, step-by-step practice, and a wrap-up.',
  fields: [
    { key: 'facilitator', label: 'Facilitator', type: 'text', example: 'Jane Park' },
    { key: 'date', label: 'Date', type: 'text', example: 'Sep 22' },
    { key: 'whatYoullLearn', label: "What you'll learn today (skill, who it's for, what you need)", type: 'list', min: 3, max: 3, example: 'The skill you will walk away with' },
    { key: 'agenda', label: 'Agenda', type: 'list', min: 4, max: 4, example: 'Intro and setup' },
    { key: 'steps', label: 'Hands-on steps (and the expected result to check)', type: 'list', min: 4, max: 4, example: 'Step 1 — install the toolkit' },
    { key: 'wrapUp', label: 'Wrap-up (what we covered, the habit to keep, how to get help)', type: 'list', min: 3, max: 3, example: 'What we covered' },
    { key: 'resources', label: 'Resources link', type: 'text', example: 'github.com/ssil/workshop' },
  ],
};
