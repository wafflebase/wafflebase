import {
  documentEventData,
  folderEventData,
  memberEventData,
  toActor,
} from './webhook-payload';

describe('webhook payload builders', () => {
  const doc = { id: 'd1', type: 'sheet', title: 'Q4 plan', workspaceId: 'w1' };

  it('describes a document with its folder and links', () => {
    expect(
      documentEventData(
        {
          frontendOrigin: 'https://app.example.com',
          apiOrigin: 'https://api.example.com',
        },
        doc,
        { id: 'f1', name: 'Planning' },
      ),
    ).toEqual({
      document: {
        id: 'd1',
        type: 'sheet',
        title: 'Q4 plan',
        folder: { id: 'f1', name: 'Planning' },
      },
      url: 'https://app.example.com/s/d1',
      api_url: 'https://api.example.com/api/v1/workspaces/w1/documents/d1',
    });
  });

  it('omits links it cannot build and nulls the root folder', () => {
    expect(documentEventData({}, doc, null)).toEqual({
      document: { id: 'd1', type: 'sheet', title: 'Q4 plan', folder: null },
    });
  });

  it('describes folders, members and actors', () => {
    expect(folderEventData({ id: 'f', name: 'A', parentId: null })).toEqual({
      folder: { id: 'f', name: 'A', parent_id: null },
    });
    expect(
      memberEventData({ id: 3, username: 'u', email: 'u@x' }, 'member'),
    ).toEqual({
      member: {
        id: 3,
        username: 'u',
        email: 'u@x',
        role: 'member',
        kind: 'user',
      },
    });
    expect(toActor({ id: 1, username: 'a' })).toEqual({ id: 1, username: 'a' });
    expect(toActor(null)).toBeNull();
  });
});
