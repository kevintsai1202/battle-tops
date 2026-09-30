import { describe, expect, test } from 'vitest';
import { dragVector, followOrigin, GestureTracker } from '../src/ui/touch';

describe('拖曳向量換算（浮動原點）', () => {
  const R = 60;
  const DZ = 0.2;

  test('死區內回傳 0（手指輕放不會亂動）', () => {
    expect(dragVector(5, -5, R, DZ)).toEqual({ x: 0, y: 0 });
  });

  test('往右拖到半徑 = x 1', () => {
    const v = dragVector(R, 0, R, DZ);
    expect(v.x).toBeCloseTo(1, 6);
    expect(v.y).toBeCloseTo(0, 6);
  });

  test('螢幕往上拖（dy 為負）= 往前（y 為正），與 W 鍵相同', () => {
    expect(dragVector(0, -R, R, DZ).y).toBeCloseTo(1, 6);
  });

  test('超出半徑時長度截斷為 1', () => {
    const v = dragVector(3 * R, 4 * R, R, DZ);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1, 6);
    expect(v.x).toBeCloseTo(0.6, 6);
    expect(v.y).toBeCloseTo(-0.8, 6);
  });

  test('死區外從 0 平滑開始：拖一半時強度為 (0.5 − 死區)/(1 − 死區)', () => {
    expect(dragVector(R * 0.5, 0, R, DZ).x).toBeCloseTo((0.5 - DZ) / (1 - DZ), 6);
  });
});

describe('浮動原點跟隨', () => {
  test('手指在半徑內：原點不動', () => {
    expect(followOrigin({ x: 100, y: 100 }, { x: 130, y: 100 }, 60)).toEqual({ x: 100, y: 100 });
  });

  test('手指超出半徑：原點被拖過去，和手指保持剛好半徑的距離（往回拉時方向能立刻反轉）', () => {
    const o = followOrigin({ x: 100, y: 100 }, { x: 300, y: 100 }, 60);
    expect(o.x).toBeCloseTo(240, 6);
    expect(o.y).toBeCloseTo(100, 6);
  });
});

describe('手勢追蹤：拖曳、快甩、三指必殺', () => {
  /** 用固定的尺度（畫面短邊 400 px）建立追蹤器 */
  const make = () => new GestureTracker({ radius: 60, deadzone: 0.18, scale: 400 });

  test('單指按住拖曳：推移向量朝拖的方向；放開後歸零', () => {
    const g = make();
    g.down(1, 200, 200, 0);
    g.move(1, 200, 140, 0.5);
    expect(g.vector().y).toBeGreaterThan(0.8);
    g.up(1, 200, 140, 1.0);
    expect(g.vector()).toEqual({ x: 0, y: 0 });
  });

  test('快甩：放手前 0.1 秒內甩得夠快夠遠 → 回傳甩的方向（螢幕往右 = x 正）', () => {
    const g = make();
    g.down(1, 100, 200, 0);
    g.move(1, 140, 200, 0.03);
    g.move(1, 190, 200, 0.06);
    const ev = g.up(1, 200, 200, 0.08);
    const flick = ev.find((e) => e.type === 'flick');
    expect(flick).toBeDefined();
    expect(flick!.type === 'flick' && flick!.dir.x).toBeCloseTo(1, 6);
  });

  test('放手事件晚一點才到、位置和最後一次移動相同：仍算快甩（看最後一段移動的速度）', () => {
    const g = make();
    g.down(1, 100, 200, 0);
    g.move(1, 220, 200, 0.06);
    g.move(1, 340, 200, 0.12);
    const ev = g.up(1, 340, 200, 0.2);
    const flick = ev.find((e) => e.type === 'flick');
    expect(flick && flick.type === 'flick' && flick.dir.x).toBeCloseTo(1, 6);
  });

  test('甩完停住一下才放手：不算快甩', () => {
    const g = make();
    g.down(1, 100, 200, 0);
    g.move(1, 300, 200, 0.05);
    expect(g.up(1, 300, 200, 0.5).some((e) => e.type === 'flick')).toBe(false);
  });

  test('慢慢拖再放開：不算快甩', () => {
    const g = make();
    g.down(1, 100, 200, 0);
    for (let i = 1; i <= 10; i++) g.move(1, 100 + i * 10, 200, i * 0.1);
    expect(g.up(1, 200, 200, 1.05).some((e) => e.type === 'flick')).toBe(false);
  });

  test('拖了很久最後一甩也算快甩（看放手前的速度，不看拖了多久）', () => {
    const g = make();
    g.down(1, 200, 200, 0);
    g.move(1, 200, 150, 1.0);
    g.move(1, 200, 150, 2.0);
    g.move(1, 200, 110, 2.04);
    const ev = g.up(1, 200, 80, 2.07);
    const flick = ev.find((e) => e.type === 'flick');
    expect(flick && flick.type === 'flick' && flick.dir.y).toBeCloseTo(1, 6);
  });

  test('第三隻手指按下的瞬間發動必殺（不等放開），只發一次', () => {
    const g = make();
    expect(g.down(1, 100, 100, 0)).toEqual([]);
    expect(g.down(2, 200, 100, 0.02)).toEqual([]);
    expect(g.down(3, 300, 100, 0.04)).toEqual([{ type: 'special' }]);
    expect(g.down(4, 350, 100, 0.05)).toEqual([]);
    g.up(4, 350, 100, 0.2);
    g.up(3, 300, 100, 0.2);
    expect(g.down(3, 300, 100, 0.3)).toEqual([]);
  });

  test('全部手指放開後可以再用三指發動一次（下一回合用）', () => {
    const g = make();
    g.down(1, 100, 100, 0);
    g.down(2, 200, 100, 0);
    g.down(3, 300, 100, 0);
    for (const id of [1, 2, 3]) g.up(id, 0, 0, 0.3);
    g.down(1, 100, 100, 1);
    g.down(2, 200, 100, 1);
    expect(g.down(3, 300, 100, 1)).toEqual([{ type: 'special' }]);
  });

  test('拖曳中加上兩指發動必殺：原本拖曳的手指繼續控制；之後放開不算快甩', () => {
    const g = make();
    g.down(1, 200, 200, 0);
    g.move(1, 260, 200, 0.2);
    g.down(2, 400, 100, 0.3);
    expect(g.down(3, 450, 100, 0.32)).toEqual([{ type: 'special' }]);
    g.move(1, 200, 140, 0.4);
    expect(g.vector().y).toBeGreaterThan(0.5);
    g.move(1, 200, 60, 0.45);
    expect(g.up(1, 200, 20, 0.47).some((e) => e.type === 'flick')).toBe(false);
  });

  test('多出來的手指不會變成拖曳原點：拖曳手指放開後，移動其他手指不會推移', () => {
    const g = make();
    g.down(1, 200, 200, 0);
    g.down(2, 400, 200, 0.1);
    g.up(1, 200, 200, 0.2);
    g.move(2, 400, 100, 0.3);
    expect(g.vector()).toEqual({ x: 0, y: 0 });
    // 其他手指放開後，重新單指按下又能拖曳
    g.up(2, 400, 100, 0.4);
    g.down(5, 200, 200, 0.5);
    g.move(5, 260, 200, 0.6);
    expect(g.vector().x).toBeGreaterThan(0.5);
  });

  test('第二隻手指按下後，放開拖曳手指不算快甩（避免雙指操作時誤觸衝刺）', () => {
    const g = make();
    g.down(1, 100, 200, 0);
    g.down(2, 400, 200, 0.01);
    g.move(1, 190, 200, 0.05);
    expect(g.up(1, 200, 200, 0.07).some((e) => e.type === 'flick')).toBe(false);
  });

  test('reset：清空所有手指（離開對戰畫面時）', () => {
    const g = make();
    g.down(1, 200, 200, 0);
    g.move(1, 260, 200, 0.2);
    g.reset();
    expect(g.vector()).toEqual({ x: 0, y: 0 });
    expect(g.dragging).toBe(false);
  });
});
