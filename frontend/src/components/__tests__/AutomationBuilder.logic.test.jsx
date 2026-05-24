import { describe, it, expect } from 'vitest';
import {
  nodeH,
  outputHandlesOf,
  handlePos,
  layoutTree,
  makeNode,
  edgePath,
} from '../AutomationBuilderView.jsx';

describe('nodeH', () => {
  it('returns 96 for trigger nodes', () => {
    expect(nodeH({ type: 'trigger' })).toBe(96);
  });

  it('returns 96 for delay nodes', () => {
    expect(nodeH({ type: 'delay' })).toBe(96);
  });

  it('returns 118 for condition nodes', () => {
    expect(nodeH({ type: 'condition' })).toBe(118);
  });

  it('returns 102 for message nodes', () => {
    expect(nodeH({ type: 'message' })).toBe(102);
  });

  it('returns base height for action with no actions', () => {
    expect(nodeH({ type: 'action', actions: [] })).toBe(96);
  });

  it('calculates height based on action count', () => {
    expect(nodeH({ type: 'action', actions: [{}, {}] })).toBe(44 + 2 * 54);
  });

  it('returns at least 96 for action with many actions', () => {
    expect(nodeH({ type: 'action', actions: new Array(10).fill({}) })).toBe(44 + 10 * 54);
  });
});

describe('outputHandlesOf', () => {
  it('returns ["default"] for trigger', () => {
    expect(outputHandlesOf({ type: 'trigger' })).toEqual(['default']);
  });

  it('returns ["yes","no"] for condition', () => {
    expect(outputHandlesOf({ type: 'condition' })).toEqual(['yes', 'no']);
  });

  it('returns ["default"] for message without buttons', () => {
    expect(outputHandlesOf({ type: 'message' })).toEqual(['default']);
  });

  it('returns ["default"] for message with empty buttons', () => {
    expect(outputHandlesOf({ type: 'message', buttons: [] })).toEqual(['default']);
  });

  it('returns button handles for message with buttons', () => {
    expect(outputHandlesOf({ type: 'message', buttons: ['A', 'B'] })).toEqual(['btn:0', 'btn:1']);
  });

  it('returns ["default"] for action', () => {
    expect(outputHandlesOf({ type: 'action' })).toEqual(['default']);
  });

  it('returns ["default"] for delay', () => {
    expect(outputHandlesOf({ type: 'delay' })).toEqual(['default']);
  });

  it('returns ["default"] for unknown type', () => {
    expect(outputHandlesOf({ type: 'unknown' })).toEqual(['default']);
  });
});

describe('handlePos', () => {
  const NODE_W = 240;

  it('positions input handle at top center', () => {
    const n = { type: 'trigger', x: 100, y: 50 };
    expect(handlePos(n, 'input')).toEqual({ x: 100 + NODE_W / 2, y: 50 });
  });

  it('positions default output at bottom center', () => {
    const n = { type: 'trigger', x: 100, y: 50 };
    expect(handlePos(n, 'output', 'default')).toEqual({ x: 100 + NODE_W / 2, y: 50 + 96 });
  });

  it('positions condition yes handle at left third', () => {
    const n = { type: 'condition', x: 100, y: 50 };
    expect(handlePos(n, 'output', 'yes')).toEqual({ x: 100 + NODE_W / 3, y: 50 + 118 });
  });

  it('positions condition no handle at right third', () => {
    const n = { type: 'condition', x: 100, y: 50 };
    expect(handlePos(n, 'output', 'no')).toEqual({ x: 100 + (NODE_W * 2) / 3, y: 50 + 118 });
  });

  it('positions button handles evenly across width', () => {
    const n = { type: 'message', x: 0, y: 0, buttons: ['A', 'B', 'C'] };
    const p0 = handlePos(n, 'output', 'btn:0');
    const p1 = handlePos(n, 'output', 'btn:1');
    const p2 = handlePos(n, 'output', 'btn:2');

    // 3 buttons → positions at 1/4, 2/4, 3/4 of width
    expect(p0.x).toBeCloseTo((1 * NODE_W) / 4, 5);
    expect(p1.x).toBeCloseTo((2 * NODE_W) / 4, 5);
    expect(p2.x).toBeCloseTo((3 * NODE_W) / 4, 5);
  });

  it('returns bottom center for unknown handle on non-special node', () => {
    const n = { type: 'delay', x: 100, y: 50 };
    expect(handlePos(n, 'output', 'something')).toEqual({ x: 100 + NODE_W / 2, y: 50 + 96 });
  });
});

describe('makeNode', () => {
  it('creates trigger node with defaults', () => {
    const n = makeNode('trigger', 10, 20, 'n99', []);
    expect(n.type).toBe('trigger');
    expect(n.x).toBe(10);
    expect(n.y).toBe(20);
    expect(n.id).toBe('n99');
    expect(n.triggerKind).toBe('keyword');
    expect(n.keyword).toBe('');
  });

  it('creates message node with empty templateId', () => {
    const n = makeNode('message', 0, 0, 'n1', []);
    expect(n.type).toBe('message');
    expect(n.templateId).toBe('');
    expect(n.bindings).toEqual({});
  });

  it('creates condition node with empty rules', () => {
    const n = makeNode('condition', 0, 0, 'n1', []);
    expect(n.type).toBe('condition');
    expect(n.matchMode).toBe('all');
    expect(n.rules).toEqual([]);
  });

  it('creates action node with empty actions', () => {
    const n = makeNode('action', 0, 0, 'n1', []);
    expect(n.type).toBe('action');
    expect(n.actions).toEqual([]);
  });

  it('creates delay node with default duration', () => {
    const n = makeNode('delay', 0, 0, 'n1', []);
    expect(n.type).toBe('delay');
    expect(n.delayMode).toBe('duration');
    expect(n.waitValue).toBe('10');
    expect(n.waitUnit).toBe('minutes');
  });

  it('creates api node with POST default', () => {
    const n = makeNode('api', 0, 0, 'n1', []);
    expect(n.type).toBe('api');
    expect(n.method).toBe('POST');
    expect(n.headers).toEqual({});
  });

  it('creates handoff node with defaults', () => {
    const n = makeNode('handoff', 0, 0, 'n1', []);
    expect(n.type).toBe('handoff');
    expect(n.assignMode).toBe('specific');
    expect(n.priority).toBe('high');
  });

  it('creates ai node with defaults', () => {
    const n = makeNode('ai', 0, 0, 'n1', []);
    expect(n.type).toBe('ai');
    expect(n.aiTask).toBe('lead_qualification');
  });

  it('creates subflow node with defaults', () => {
    const n = makeNode('subflow', 0, 0, 'n1', []);
    expect(n.type).toBe('subflow');
    expect(n.flowId).toBe('');
    expect(n.waitMode).toBe('await');
  });

  it('handles unknown type gracefully', () => {
    const n = makeNode('unknown', 5, 10, 'nX', []);
    expect(n.type).toBe('unknown');
    expect(n.x).toBe(5);
    expect(n.y).toBe(10);
  });
});

describe('layoutTree', () => {
  it('places a single root node', () => {
    const nodes = [{ id: 'n1', type: 'trigger' }];
    const edges = [];
    const result = layoutTree(nodes, edges);
    expect(result[0].x).toBe(80);
    expect(result[0].y).toBe(60);
  });

  it('places root child below root', () => {
    const nodes = [
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'message' },
    ];
    const edges = [{ from: 'n1', to: 'n2' }];
    const result = layoutTree(nodes, edges);
    const root = result.find(n => n.id === 'n1');
    const child = result.find(n => n.id === 'n2');
    expect(child.y).toBe(root.y + 180);
  });

  it('places two children side by side', () => {
    const nodes = [
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'message' },
      { id: 'n3', type: 'message' },
    ];
    const edges = [
      { from: 'n1', to: 'n2' },
      { from: 'n1', to: 'n3' },
    ];
    const result = layoutTree(nodes, edges);
    const n2 = result.find(n => n.id === 'n2');
    const n3 = result.find(n => n.id === 'n3');
    expect(n2.x).not.toBe(n3.x);
    expect(n2.y).toBe(n3.y);
  });

  it('does not place nodes that have inbound edges as roots', () => {
    const nodes = [
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'message' },
    ];
    const edges = [{ from: 'n1', to: 'n2' }];
    const result = layoutTree(nodes, edges);
    // n2 should be placed by walk from n1, not as a separate root
    expect(result.find(n => n.id === 'n2').y).toBeGreaterThan(result.find(n => n.id === 'n1').y);
  });

  it('does not re-place already-placed nodes (prevents cycles)', () => {
    const nodes = [
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'message' },
    ];
    const edges = [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n1' }, // cycle
    ];
    // Should not infinite loop
    const result = layoutTree(nodes, edges);
    expect(result).toHaveLength(2);
  });

  it('handles empty nodes array', () => {
    expect(layoutTree([], [])).toEqual([]);
  });

  it('handles nodes with no edges as multiple roots', () => {
    const nodes = [
      { id: 'n1', type: 'trigger' },
      { id: 'n2', type: 'trigger' },
    ];
    const result = layoutTree(nodes, []);
    expect(result[0].x).not.toBe(result[1].x);
  });
});

describe('edgePath', () => {
  it('generates a cubic bezier path string', () => {
    const path = edgePath(0, 0, 100, 200);
    expect(path).toContain('M 0 0');
    expect(path).toContain('C');
    expect(path).toContain('100 200');
  });

  it('uses at least 40 for control point distance', () => {
    const path = edgePath(0, 0, 0, 50);
    expect(path).toMatch(/C 0 \d+, 0 \d+, 0 50/);
  });

  it('scales control distance for larger gaps', () => {
    const path1 = edgePath(0, 0, 0, 100);
    const path2 = edgePath(0, 0, 0, 400);
    // path2 should have larger control point offsets
    expect(path1).not.toBe(path2);
  });
});
