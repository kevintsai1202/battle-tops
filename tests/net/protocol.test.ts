import { describe, expect, test } from 'vitest';
import { MAX_AIM } from '../../src/sim/launcher';
import { isRoomCode, makeRoomCode, parseClientMessage, PROTOCOL_VERSION, sanitizeName, validateTeam } from '../../src/net/protocol';
import { createRng } from '../../src/sim/rng';

describe('房號', () => {
  test('4 碼、不含容易混淆的 I、O、0、1，並能辨識合法房號', () => {
    const rng = createRng(1);
    for (let i = 0; i < 200; i++) {
      const code = makeRoomCode(rng);
      expect(code).toMatch(/^[A-Z2-9]{4}$/);
      expect(code).not.toMatch(/[IO01]/);
      expect(isRoomCode(code)).toBe(true);
    }
    expect(isRoomCode('AB1D')).toBe(false);
    expect(isRoomCode('abcd')).toBe(false);
    expect(isRoomCode('ABCDE')).toBe(false);
  });
});

describe('玩家名稱', () => {
  test('去掉前後空白與控制字元、限制 12 個字，空的用預設名稱', () => {
    expect(sanitizeName('  小明  ')).toBe('小明');
    expect(sanitizeName('a\u0000b\nc')).toBe('abc');
    expect(sanitizeName('一二三四五六七八九十一二三四')).toBe('一二三四五六七八九十一二');
    expect(sanitizeName('   ')).toBe('Player');
    expect(sanitizeName(undefined)).toBe('Player');
  });
});

describe('客戶端訊息檢查', () => {
  test('不是 JSON、太大、未知類型、缺欄位都丟掉（回 null）', () => {
    expect(parseClientMessage('not json')).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'ping', c: 1, pad: 'x'.repeat(3000) }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'hack' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'join' }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'join', code: 'AB1D', name: 'x' }))).toBeNull();
    expect(parseClientMessage('[1,2]')).toBeNull();
  });

  test('房號轉大寫後檢查、名稱會清理', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'join', code: 'abcd', name: '  阿明 ', v: 2 }))).toEqual({ t: 'join', code: 'ABCD', name: '阿明', v: 2 });
    expect(parseClientMessage(JSON.stringify({ t: 'create', name: 'Kevin', v: 2 }))).toEqual({ t: 'create', name: 'Kevin', public: true, v: 2 });
  });

  test('推移：非有限數字丟掉；長度超過 1 正規化成 1', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'input', seq: 1, x: 'a', z: 0 }))).toBeNull();
    expect(parseClientMessage('{"t":"input","seq":1,"x":1e999,"z":0}')).toBeNull();
    const m = parseClientMessage(JSON.stringify({ t: 'input', seq: 3, x: 3, z: 4 }));
    expect(m).toMatchObject({ t: 'input', seq: 3 });
    expect(m && m.t === 'input' && m.x).toBeCloseTo(0.6, 12);
    expect(m && m.t === 'input' && m.z).toBeCloseTo(0.8, 12);
  });

  test('衝刺方向長度為 0 丟掉；有方向就正規化', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'dash', seq: 2, x: 0, z: 0 }))).toBeNull();
    const m = parseClientMessage(JSON.stringify({ t: 'dash', seq: 2, x: 0, z: -5 }));
    expect(m).toEqual({ t: 'dash', seq: 2, x: 0, z: -1 });
  });

  test('發射：時機誤差夾在 ±2 秒、拉條數值夾在 0～1、瞄準夾在 ±35°', () => {
    const m = parseClientMessage(JSON.stringify({ t: 'launch', error: -9, aim: 3, pull: { length: 7, speed: -1, aim: 0.1 } }));
    expect(m).toEqual({ t: 'launch', error: -2, aim: MAX_AIM, pull: { length: 1, speed: 0, aim: 0.1 } });
    expect(parseClientMessage(JSON.stringify({ t: 'launch', error: 0.05, aim: 0, pull: null }))).toEqual({ t: 'launch', error: 0.05, aim: 0, pull: null });
  });

  test('序號必須是非負整數', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'special', seq: -1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'special', seq: 1.5 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: 'special', seq: 7 }))).toEqual({ t: 'special', seq: 7 });
  });

  test('場地選擇只接受五個場地與隨機', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'arena', arena: 'volcano' }))).toEqual({ t: 'arena', arena: 'volcano' });
    expect(parseClientMessage(JSON.stringify({ t: 'arena', arena: 'random' }))).toEqual({ t: 'arena', arena: 'random' });
    expect(parseClientMessage(JSON.stringify({ t: 'arena', arena: 'moon' }))).toBeNull();
  });

  test('重連需要房號與 token', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'resume', code: 'ABCD', token: 'x'.repeat(24), v: 2 }))).toEqual({ t: 'resume', code: 'ABCD', token: 'x'.repeat(24), v: 2 });
    expect(parseClientMessage(JSON.stringify({ t: 'resume', code: 'ABCD' }))).toBeNull();
  });
});

describe('隊伍檢查', () => {
  test('三顆不重複的合法陀螺', () => {
    expect(validateTeam(['blaze', 'turtle', 'gale'], {})).toBeNull();
    expect(validateTeam(['blaze', 'blaze', 'gale'], {})).not.toBeNull();
    expect(validateTeam(['blaze', 'turtle'], {})).not.toBeNull();
    expect(validateTeam(['blaze', 'turtle', 'nope'], {})).not.toBeNull();
  });

  test('零件：只能裝在自己隊伍的陀螺上、欄位要對、備用零件同隊不能重複', () => {
    expect(validateTeam(['blaze', 'turtle', 'gale'], { blaze: { disk: 'heavy', driver: 'bearing' } })).toBeNull();
    expect(validateTeam(['blaze', 'turtle', 'gale'], { orion: { disk: 'heavy', driver: null } })).not.toBeNull();
    expect(validateTeam(['blaze', 'turtle', 'gale'], { blaze: { disk: 'bearing', driver: null } })).not.toBeNull();
    expect(validateTeam(['blaze', 'turtle', 'gale'], { blaze: { disk: null, driver: 'sharp' }, turtle: { disk: null, driver: 'sharp' } })).not.toBeNull();
    expect(validateTeam(['blaze', 'turtle', 'gale'], { blaze: { disk: 'nope', driver: null } })).not.toBeNull();
  });

  test('第 1 步選三顆、第 2 步順序與零件的訊息經過檢查：不合法的整則丟掉；舊的一次送出隊伍訊息已移除', () => {
    const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));
    expect(parse({ t: 'picks', picks: ['blaze', 'turtle', 'gale'] })).toEqual({ t: 'picks', picks: ['blaze', 'turtle', 'gale'] });
    expect(parse({ t: 'picks', picks: ['blaze', 'blaze', 'gale'] })).toBeNull();
    expect(parse({ t: 'picks', picks: ['blaze', 'turtle'] })).toBeNull();
    expect(parse({ t: 'picks', picks: ['blaze', 'turtle', 'nope'] })).toBeNull();
    for (const t of ['arrange', 'ready'] as const) {
      const loadouts = { blaze: { disk: 'heavy', driver: null } };
      expect(parse({ t, order: ['gale', 'blaze', 'turtle'], loadouts })).toEqual({ t, order: ['gale', 'blaze', 'turtle'], loadouts });
      expect(parse({ t, order: ['gale', 'gale', 'turtle'], loadouts: {} })).toBeNull();
      // 備用零件同隊不能重複
      expect(parse({ t, order: ['blaze', 'turtle', 'gale'], loadouts: { blaze: { disk: null, driver: 'sharp' }, turtle: { disk: null, driver: 'sharp' } } })).toBeNull();
    }
    expect(parse({ t: 'team', picks: ['blaze', 'turtle', 'gale'], loadouts: {} })).toBeNull();
  });
});

describe('房間列表與快速加入', () => {
  test('list、quick 與建房的公開設定：沒帶 public（舊版網頁）或不是 false 都視為公開', () => {
    expect(parseClientMessage(JSON.stringify({ t: 'list' }))).toEqual({ t: 'list' });
    expect(parseClientMessage(JSON.stringify({ t: 'quick', name: ' 小明 ', v: 2 }))).toEqual({ t: 'quick', name: '小明', v: 2 });
    expect(parseClientMessage(JSON.stringify({ t: 'create', name: 'A', v: 2 }))).toEqual({ t: 'create', name: 'A', public: true, v: 2 });
    expect(parseClientMessage(JSON.stringify({ t: 'create', name: 'A', public: false, v: 2 }))).toEqual({ t: 'create', name: 'A', public: false, v: 2 });
    expect(parseClientMessage(JSON.stringify({ t: 'create', name: 'A', public: 'no', v: 2 }))).toEqual({ t: 'create', name: 'A', public: true, v: 2 });
  });
});

describe('協定版本', () => {
  test('建房、加入、快速加入、重連都帶協定版本；沒帶或不是數字（舊版網頁）為 0，由伺服器回「請重新整理」', () => {
    const parse = (m: unknown) => parseClientMessage(JSON.stringify(m));
    expect(PROTOCOL_VERSION).toBe(2);
    expect(parse({ t: 'create', name: 'A' })).toMatchObject({ v: 0 });
    expect(parse({ t: 'join', code: 'ABCD', name: 'A', v: 2 })).toMatchObject({ v: 2 });
    expect(parse({ t: 'quick', name: 'A', v: 'x' })).toMatchObject({ v: 0 });
    expect(parse({ t: 'resume', code: 'ABCD', token: 'x'.repeat(24), v: 2 })).toMatchObject({ v: 2 });
    expect(parse({ t: 'resume', code: 'ABCD', token: 'x'.repeat(24) })).toMatchObject({ v: 0 });
  });
});
