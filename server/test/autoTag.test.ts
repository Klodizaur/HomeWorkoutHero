import { describe, expect, it } from 'vitest';
import { autoTagFromTitle } from '../src/autoTag.js';

describe('autoTagFromTitle', () => {
  it('reads tags from Polish and English titles', () => {
    expect(autoTagFromTitle('Pośladki i brzuch z hantlami – intensywny trening')).toEqual({
      equipment: ['dumbbells'],
      training_type: [],
      body_parts: ['core', 'glutes'],
      intensity: 'high',
    });
    expect(autoTagFromTitle('Gentle yoga for back and shoulders')).toEqual({
      equipment: [],
      training_type: ['Yoga'],
      body_parts: ['back', 'shoulders'],
      intensity: 'low',
    });
  });

  // "ł" has no Unicode decomposition, so stripping accents alone loses it.
  it('reads words spelled with ł', () => {
    expect(autoTagFromTitle('Całe ciało').body_parts).toEqual(['full_body']);
    expect(autoTagFromTitle('Trening całego ciała').body_parts).toEqual(['full_body']);
    expect(autoTagFromTitle('Góra ciała').body_parts).toEqual(['upper_body']);
    expect(autoTagFromTitle('Dół ciała').body_parts).toEqual(['lower_body']);
    expect(autoTagFromTitle('Zdrowy kręgosłup').body_parts).toEqual(['back']);
    expect(autoTagFromTitle('Trening siłowy').training_type).toEqual(['Strength']);
    expect(autoTagFromTitle('Piłka gimnastyczna').equipment).toEqual(['gym_ball']);
    expect(autoTagFromTitle('Mała piłka').equipment).toEqual(['pilates_ball']);
    expect(autoTagFromTitle('ŁAGODNY STRETCHING').intensity).toBe('low');
  });

  it('matches stems across Polish inflection', () => {
    for (const title of ['Hantle', 'Trening z hantlami', 'Ćwiczenia z hantelkami']) {
      expect(autoTagFromTitle(title).equipment, title).toEqual(['dumbbells']);
    }
  });

  describe('matches whole words, never bare substrings', () => {
    it.each([
      ['Automata challenge', 'equipment', 'mat'],
      ['Hardcore cardio', 'body_parts', 'core'],
      ['Comeback workout', 'body_parts', 'back'],
      ['Udany dzień', 'body_parts', 'legs'],
    ] as const)('%s', (title, field, tag) => {
      expect(autoTagFromTitle(title)[field]).not.toContain(tag);
    });

    it('still finds the word when it stands on its own', () => {
      expect(autoTagFromTitle('Hardcore core').body_parts).toEqual(['core']);
      expect(autoTagFromTitle('Ćwiczenia na macie, mata obowiązkowa').equipment).toEqual(['mat']);
    });
  });

  describe('understands negation', () => {
    it.each([
      'Trening bez hantli',
      'Full body without dumbbells',
      'Bez użycia hantli',
      'Zero dumbbells needed',
    ])('%s → no dumbbells', title => {
      expect(autoTagFromTitle(title).equipment).not.toContain('dumbbells');
    });

    it('only looks a couple of words back', () => {
      // "bez" is three words before "hantle", outside the window.
      expect(autoTagFromTitle('Bez sprzętu, potem hantle').equipment).toEqual(['dumbbells']);
    });

    it('keeps tags whose own phrase starts with a negation', () => {
      expect(autoTagFromTitle('Cardio bez skakania').training_type).toEqual(['Cardio', 'No Jumping']);
      expect(autoTagFromTitle('Low impact cardio, no jumping').training_type).toEqual(['Cardio', 'No Jumping']);
    });
  });

  it('picks a single intensity, preferring the explicit one', () => {
    expect(autoTagFromTitle('Łagodny, ale intensywny').intensity).toBe('high');
    expect(autoTagFromTitle('Średnio zaawansowany').intensity).toBe('medium');
  });

  it('returns empty tags when nothing is recognised', () => {
    const empty = { equipment: [], training_type: [], body_parts: [], intensity: '' };
    expect(autoTagFromTitle('')).toEqual(empty);
    expect(autoTagFromTitle('Sesja 12')).toEqual(empty);
  });
});
