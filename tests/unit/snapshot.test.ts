import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { deriveSnapshot } from '../../src/realtime/persistence.js';

function buildDoc(): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment('content');

  const heading = new Y.XmlElement('heading');
  heading.setAttribute('level', '1');
  const headingText = new Y.XmlText();
  headingText.insert(0, 'Hello');
  heading.insert(0, [headingText]);

  const paragraph = new Y.XmlElement('paragraph');
  const paragraphText = new Y.XmlText();
  paragraphText.insert(0, 'World', { bold: true });
  paragraph.insert(0, [paragraphText]);

  fragment.insert(0, [heading, paragraph]);
  return doc;
}

describe('deriveSnapshot', () => {
  it('converts the content fragment into block JSON', () => {
    const snapshot = deriveSnapshot(buildDoc()) as {
      blocks: { type: string; attrs: Record<string, string>; children: unknown[] }[];
    };

    expect(snapshot.blocks).toHaveLength(2);
    expect(snapshot.blocks[0]).toMatchObject({ type: 'heading', attrs: { level: '1' } });
    expect(snapshot.blocks[1]).toMatchObject({ type: 'paragraph' });
  });

  it('emits text as delta so formatting marks survive', () => {
    const snapshot = deriveSnapshot(buildDoc()) as {
      blocks: { children: { type: string; delta: unknown[] }[] }[];
    };

    const textNode = snapshot.blocks[1]!.children[0]!;
    expect(textNode.type).toBe('text');
    expect(textNode.delta).toEqual([{ insert: 'World', attributes: { bold: true } }]);
  });

  it('round-trips through encoded CRDT state', () => {
    const original = buildDoc();
    const replica = new Y.Doc();
    Y.applyUpdate(replica, Y.encodeStateAsUpdate(original));

    expect(deriveSnapshot(replica)).toEqual(deriveSnapshot(original));
  });

  it('returns empty blocks for a fresh document', () => {
    expect(deriveSnapshot(new Y.Doc())).toEqual({ blocks: [] });
  });
});
