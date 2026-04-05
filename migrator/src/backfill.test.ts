import { describe, it, expect } from 'vitest';
import { groupPhotosByActivity } from './backfill.js';

describe('groupPhotosByActivity', () => {
  it('groups photos by activityId', () => {
    const photos = [
      { activityId: 'act1', imageFileName: 'a.jpg' },
      { activityId: 'act1', imageFileName: 'b.jpg' },
      { activityId: 'act2', imageFileName: 'c.jpg' },
    ];
    const result = groupPhotosByActivity(photos);
    expect(result.get('act1')).toHaveLength(2);
    expect(result.get('act2')).toHaveLength(1);
    expect(result.get('act3')).toBeUndefined();
  });

  it('returns empty map for empty input', () => {
    expect(groupPhotosByActivity([])).toEqual(new Map());
  });
});
