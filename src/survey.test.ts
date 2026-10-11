import { describe, expect, it } from 'vitest';
import { nextSurveyQuestion, parseSurveyState, surveyDue, surveyQuestions } from './survey';
import { eventSchema } from './telemetry';

const real = { demo: false, completed: true, seconds: 1800 };
const demo = { demo: true, completed: true, seconds: 1800 };
const fresh = parseSurveyState(null);

describe('ride survey', () => {
  it('appears from the third real ride, never for demos or short aborted rides', () => {
    expect(surveyDue(fresh, real, [real, real])).toBe(false);
    expect(surveyDue(fresh, real, [real, real, real])).toBe(true);
    expect(surveyDue(fresh, real, [real, demo, demo, real])).toBe(false);
    expect(surveyDue(fresh, demo, [real, real, real, demo])).toBe(false);
    expect(surveyDue(fresh, { demo: false, completed: false, seconds: 120 }, [real, real, real])).toBe(false);
  });
  it('asks the questions in order and stops when answered or dismissed', () => {
    expect(nextSurveyQuestion(fresh)?.id).toBe('other_app');
    expect(nextSurveyQuestion({ answered: ['other_app'], dismissed: false })?.id).toBe('switch');
    expect(nextSurveyQuestion({ answered: ['other_app', 'switch'], dismissed: false })).toBeNull();
    expect(nextSurveyQuestion({ answered: [], dismissed: true })).toBeNull();
    expect(surveyDue({ answered: [], dismissed: true }, real, [real, real, real])).toBe(false);
  });
  it('reads stored state defensively', () => {
    expect(parseSurveyState({ answered: ['switch', 'bogus'], dismissed: 'yes' })).toEqual({ answered: ['switch'], dismissed: false });
    expect(parseSurveyState('garbage')).toEqual({ answered: [], dismissed: false });
  });
  it('offers only answers the telemetry schema accepts', () => {
    const allowed = eventSchema.survey_answer.answer;
    for (const question of surveyQuestions) for (const option of question.options) expect(allowed).toContain(option.value);
    expect(surveyQuestions.map(q => q.options.length)).toEqual([6, 3]);
  });
});
