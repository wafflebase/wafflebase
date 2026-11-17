import { describe, expect, it } from 'vitest';
import type { FreeformCommand } from './element';
import {
  FREEFORM_QUANTUM,
  decodeFreeformCommands,
  decodeFreeformData,
  decodeFreeformElements,
  encodeFreeformCommands,
  encodeFreeformData,
  encodeFreeformElement,
} from './freeform-codec';

const ink: FreeformCommand[] = [
  { c: 'M', x: 0, y: 0.5 },
  { c: 'Q', x1: 0.1234, y1: 0.4, x: 0.2, y: 0.45 },
  { c: 'Q', x1: 0.3, y1: 0.9999, x: 1, y: 1 },
];

function close(a: FreeformCommand[], b: FreeformCommand[]): void {
  expect(a.length).toBe(b.length);
  a.forEach((cmd, i) => {
    expect(cmd.c).toBe(b[i].c);
    for (const [k, v] of Object.entries(cmd)) {
      if (k === 'c') continue;
      const other = (b[i] as unknown as Record<string, number>)[k];
      expect(Math.abs((v as number) - other)).toBeLessThanOrEqual(0.5 / FREEFORM_QUANTUM);
    }
  });
}

describe('freeform codec', () => {
  it('round-trips an ink path within one quantum', () => {
    const packed = encodeFreeformCommands(ink);
    expect(packed).toMatch(/^q1:M/);
    close(decodeFreeformCommands(packed!)!, ink);
  });

  it('is shorter than the JSON array it replaces', () => {
    const cmds: FreeformCommand[] = [{ c: 'M', x: 0, y: 0 }];
    for (let i = 1; i <= 200; i++) {
      cmds.push({ c: 'Q', x1: i / 200, y1: Math.sin(i / 10) / 2 + 0.5, x: (i + 0.5) / 200, y: 0.5 });
    }
    const packed = encodeFreeformCommands(cmds)!;
    expect(packed.length).toBeLessThan(JSON.stringify(cmds).length / 3);
    close(decodeFreeformCommands(packed)!, cmds);
  });

  it('round-trips L and a single dot', () => {
    const line: FreeformCommand[] = [
      { c: 'M', x: 1, y: 0 },
      { c: 'L', x: 0, y: 1 },
    ];
    close(decodeFreeformCommands(encodeFreeformCommands(line)!)!, line);
  });

  it('refuses commands outside the ink vocabulary', () => {
    expect(encodeFreeformCommands([{ c: 'M', x: 0, y: 0 }, { c: 'Z' }])).toBeNull();
    expect(
      encodeFreeformCommands([
        { c: 'M', x: 0, y: 0 },
        { c: 'C', x1: 0, y1: 0, x2: 1, y2: 1, x: 1, y: 0 },
      ]),
    ).toBeNull();
    expect(encodeFreeformCommands([])).toBeNull();
    expect(encodeFreeformCommands([{ c: 'M', x: NaN, y: 0 }])).toBeNull();
  });

  it('decodes garbage to null', () => {
    for (const bad of ['', 'M0,0', 'q1:', 'q1:X1,2', 'q1:M1', 'q1:M1,2,3', 'q1:M1,2Qa,b,c,d', 'q2:M0,0']) {
      expect(decodeFreeformCommands(bad)).toBeNull();
    }
  });

  it('data helpers pack freeform ink and pass everything else through', () => {
    const data = { kind: 'freeform', path: { commands: ink }, stroke: { color: '#000', width: 2 } };
    const packed = encodeFreeformData(data);
    expect(typeof packed.path.commands).toBe('string');
    expect(packed.stroke).toBe(data.stroke);
    const back = decodeFreeformData(packed);
    close(back.path.commands as FreeformCommand[], ink);

    const rect = { kind: 'rect' };
    expect(encodeFreeformData(rect)).toBe(rect);
    expect(decodeFreeformData(rect)).toBe(rect);
    // An old board's array commands read as they are.
    expect(decodeFreeformData(data)).toBe(data);
    // An imported custGeom with a Z stays an array.
    const closed = { kind: 'freeform', path: { commands: [{ c: 'M', x: 0, y: 0 }, { c: 'Z' }] } };
    expect(encodeFreeformData(closed)).toBe(closed);
  });

  it('walks group children both ways', () => {
    const stroke = { id: 's', type: 'shape', data: { kind: 'freeform', path: { commands: ink } } };
    const group = { id: 'g', type: 'group', data: { children: [stroke] } };
    const packed = encodeFreeformElement(group);
    const child = (packed.data.children[0] as typeof stroke).data.path.commands;
    expect(typeof child).toBe('string');
    const [read] = decodeFreeformElements([packed]);
    close((read.data.children[0] as typeof stroke).data.path.commands, ink);
  });
});
