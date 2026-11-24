import { describe, expect, it } from 'vitest';
import { sortVideos } from '../src/lib/videoSort';
import type { Video } from '../src/types/video';

const video = (filename: string, duration_seconds: number | null, completed_count?: number) =>
  ({ id: filename, filename, duration_seconds, completed_count }) as unknown as Video;

const names = (list: Video[]) => list.map(v => v.filename);

const videos = [
  video('B.mp4', 1200, 3),
  video('A.mp4', 600, 0),
  video('C.mp4', null, 3),   // length not probed yet
  video('D.mp4', 2400),      // never done: no count at all
];

describe('video sorting', () => {
  it('goes by length either way, with unknown lengths last both times', () => {
    expect(names(sortVideos(videos, 'long'))).toEqual(['D.mp4', 'B.mp4', 'A.mp4', 'C.mp4']);
    expect(names(sortVideos(videos, 'short'))).toEqual(['A.mp4', 'B.mp4', 'D.mp4', 'C.mp4']);
    expect(names(sortVideos(videos, 'size'))).toEqual(names(sortVideos(videos, 'long')));
  });

  it('goes by times done, never-done counting as zero, ties by name', () => {
    expect(names(sortVideos(videos, 'done'))).toEqual(['B.mp4', 'C.mp4', 'A.mp4', 'D.mp4']);
    expect(names(sortVideos(videos, 'undone'))).toEqual(['A.mp4', 'D.mp4', 'B.mp4', 'C.mp4']);
  });
});
