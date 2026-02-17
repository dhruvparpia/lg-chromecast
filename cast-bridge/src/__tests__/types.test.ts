import { describe, it, expectTypeOf } from 'vitest';
import type { PlayerStatus, DisplayCommand, MediaCommand } from '../types.js';

describe('PlayerStatus', () => {
  it('has correct field types', () => {
    expectTypeOf<PlayerStatus>().toHaveProperty('playerState');
    expectTypeOf<PlayerStatus>().toHaveProperty('currentTime');
    expectTypeOf<PlayerStatus>().toHaveProperty('duration');
    expectTypeOf<PlayerStatus>().toHaveProperty('volume');
  });

  it('playerState is a union of valid states', () => {
    expectTypeOf<PlayerStatus['playerState']>().toEqualTypeOf<
      'IDLE' | 'PLAYING' | 'PAUSED' | 'BUFFERING'
    >();
  });

  it('numeric fields are numbers', () => {
    expectTypeOf<PlayerStatus['currentTime']>().toBeNumber();
    expectTypeOf<PlayerStatus['duration']>().toBeNumber();
    expectTypeOf<PlayerStatus['volume']>().toBeNumber();
  });
});

describe('DisplayCommand', () => {
  it('covers all command types', () => {
    // Verify each variant is assignable
    expectTypeOf<{ type: 'load'; url: string; contentType: string }>().toMatchTypeOf<DisplayCommand>();
    expectTypeOf<{ type: 'play' }>().toMatchTypeOf<DisplayCommand>();
    expectTypeOf<{ type: 'pause' }>().toMatchTypeOf<DisplayCommand>();
    expectTypeOf<{ type: 'seek'; currentTime: number }>().toMatchTypeOf<DisplayCommand>();
    expectTypeOf<{ type: 'stop' }>().toMatchTypeOf<DisplayCommand>();
    expectTypeOf<{ type: 'volume'; level: number }>().toMatchTypeOf<DisplayCommand>();
  });
});

describe('MediaCommand', () => {
  it('type field is required', () => {
    expectTypeOf<MediaCommand>().toHaveProperty('type');
    expectTypeOf<MediaCommand['type']>().toEqualTypeOf<
      'load' | 'play' | 'pause' | 'seek' | 'stop' | 'volume'
    >();
  });

  it('has correct optional fields', () => {
    expectTypeOf<MediaCommand>().toHaveProperty('url');
    expectTypeOf<MediaCommand>().toHaveProperty('contentType');
    expectTypeOf<MediaCommand>().toHaveProperty('currentTime');
    expectTypeOf<MediaCommand>().toHaveProperty('volume');
    expectTypeOf<MediaCommand>().toHaveProperty('requestId');
  });

  it('optional fields accept undefined', () => {
    expectTypeOf<undefined>().toMatchTypeOf<MediaCommand['url']>();
    expectTypeOf<undefined>().toMatchTypeOf<MediaCommand['contentType']>();
    expectTypeOf<undefined>().toMatchTypeOf<MediaCommand['currentTime']>();
    expectTypeOf<undefined>().toMatchTypeOf<MediaCommand['volume']>();
    expectTypeOf<undefined>().toMatchTypeOf<MediaCommand['requestId']>();
  });
});
