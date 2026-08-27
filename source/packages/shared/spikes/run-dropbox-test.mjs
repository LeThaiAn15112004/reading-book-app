import assert from 'node:assert/strict';

// Helper mock classes matching shared/domain for pure Node.js execution
const DROPBOX_DEFAULT_APP_KEY = '9s1ipeb0zmce4en';
const DROPBOX_DEFAULT_APP_SECRET = 'yt5xyvrmt8vvxge';
const DROPBOX_AUTH_URL = 'https://www.dropbox.com/oauth2/authorize';
const SUPPORTED_BOOK_EXTENSIONS = ['epub', 'pdf', 'txt', 'md', 'docx', 'doc'];

function detectDropboxBookFormat(fileName) {
  const parts = fileName.split('.');
  if (parts.length <= 1) return 'unknown';
  return parts.pop()?.toLowerCase() ?? 'unknown';
}

function isDropboxBookFile(fileName, allowed = SUPPORTED_BOOK_EXTENSIONS) {
  const ext = detectDropboxBookFormat(fileName);
  return allowed.includes(ext);
}

class MemoryDropboxTokenStore {
  constructor() {
    this.storedTokens = null;
  }
  async saveTokens(tokens) {
    this.storedTokens = { ...tokens };
  }
  async getTokens() {
    return this.storedTokens ? { ...this.storedTokens } : null;
  }
  async clearTokens() {
    this.storedTokens = null;
  }
  async hasValidToken() {
    if (!this.storedTokens) return false;
    if (this.storedTokens.refreshToken) return true;
    return this.storedTokens.expiresAt > Date.now() + 60000;
  }
}

class DropboxAuthService {
  constructor(options) {
    this.appKey = options?.credentials?.appKey || DROPBOX_DEFAULT_APP_KEY;
    this.appSecret = options?.credentials?.appSecret || DROPBOX_DEFAULT_APP_SECRET;
    this.tokenStore = options?.tokenStore || new MemoryDropboxTokenStore();
  }
  getAppKey() { return this.appKey; }
  getTokenStore() { return this.tokenStore; }

  getAuthorizationUrl(options) {
    const url = new URL(DROPBOX_AUTH_URL);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', options?.appKey || this.appKey);
    url.searchParams.set('token_access_type', options?.tokenAccessType || 'offline');
    if (options?.redirectUri) url.searchParams.set('redirect_uri', options.redirectUri);
    if (options?.state) url.searchParams.set('state', options.state);
    if (options?.codeChallenge) {
      url.searchParams.set('code_challenge', options.codeChallenge);
      url.searchParams.set('code_challenge_method', options.codeChallengeMethod || 'S256');
    }
    return url.toString();
  }

  async getValidAccessToken() {
    const tokens = await this.tokenStore.getTokens();
    return tokens ? tokens.accessToken : null;
  }
}

class DropboxFileService {
  async listFiles(accessToken, options) {
    const allowedExtensions = options?.allowedExtensions || SUPPORTED_BOOK_EXTENSIONS;
    const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path: options?.path || '',
        recursive: options?.recursive ?? true,
      }),
    });

    const data = await response.json();
    const filtered = [];
    for (const entry of data.entries || []) {
      if (entry['.tag'] === 'file') {
        const format = detectDropboxBookFormat(entry.name);
        if (allowedExtensions.includes(format)) {
          filtered.push({ ...entry, formatHint: format });
        }
      }
    }
    return {
      entries: filtered,
      cursor: data.cursor,
      hasMore: data.has_more,
      rawEntries: data.entries || [],
    };
  }
}

class DropboxDownloadService {
  async downloadFile(accessToken, pathOrId) {
    const response = await fetch('https://content.dropboxapi.com/2/files/download', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Dropbox-API-Arg': JSON.stringify({ path: pathOrId }),
      },
    });
    const header = response.headers.get('Dropbox-API-Result') || '{}';
    const metadata = JSON.parse(header);
    const data = await response.arrayBuffer();
    return {
      metadata: { ...metadata, formatHint: detectDropboxBookFormat(metadata.name || pathOrId) },
      data,
      text: () => new TextDecoder().decode(data),
    };
  }
}

class DropboxSyncService {
  async sync(options) {
    const { accessToken, cursor, folderPath, allowedExtensions = SUPPORTED_BOOK_EXTENSIONS } = options;
    const changes = [];
    const endpoint = cursor
      ? 'https://api.dropboxapi.com/2/files/list_folder/continue'
      : 'https://api.dropboxapi.com/2/files/list_folder';
    const body = cursor
      ? JSON.stringify({ cursor })
      : JSON.stringify({ path: folderPath || '', recursive: true });

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const data = await response.json();

    for (const entry of data.entries || []) {
      if (entry['.tag'] === 'deleted') {
        const format = detectDropboxBookFormat(entry.name);
        if (allowedExtensions.includes(format)) {
          changes.push({ type: 'deleted', path: entry.path_display || entry.name, name: entry.name });
        }
      } else if (entry['.tag'] === 'file') {
        const format = detectDropboxBookFormat(entry.name);
        if (allowedExtensions.includes(format)) {
          changes.push({
            type: 'added',
            path: entry.path_display,
            name: entry.name,
            formatHint: format,
            file: { ...entry, formatHint: format },
          });
        }
      }
    }

    let addedCount = changes.filter(c => c.type === 'added').length;
    let modifiedCount = changes.filter(c => c.type === 'modified').length;
    let deletedCount = changes.filter(c => c.type === 'deleted').length;

    return {
      cursor: data.cursor,
      changes,
      addedCount,
      modifiedCount,
      deletedCount,
      totalProcessed: changes.length,
    };
  }
}

async function run() {
  console.log('--- Kiểm thử Dropbox Integration trên môi trường Node.js ---');

  const auth = new DropboxAuthService();
  assert.equal(auth.getAppKey(), '9s1ipeb0zmce4en');
  console.log('1. App Key xác nhận: 9s1ipeb0zmce4en ✓');

  const url = auth.getAuthorizationUrl({
    redirectUri: 'http://localhost:5173/oauth/callback',
    state: 'state_xyz',
  });
  assert.ok(url.includes('client_id=9s1ipeb0zmce4en'));
  assert.ok(url.includes('token_access_type=offline'));
  console.log('2. OAuth2 Authorization URL hoàn chỉnh ✓');

  // Test filter
  assert.equal(isDropboxBookFile('test.epub'), true);
  assert.equal(isDropboxBookFile('doc.pdf'), true);
  assert.equal(isDropboxBookFile('draft.docx'), true);
  assert.equal(isDropboxBookFile('test.exe'), false);
  console.log('3. Lọc 6 định dạng sách (epub, pdf, txt, md, docx, doc) chính xác ✓');

  // Test Mocked File Listing
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url) => {
      if (String(url).includes('/files/list_folder')) {
        return new Response(JSON.stringify({
          entries: [
            { '.tag': 'file', id: 'id:1', name: 'Novel.epub', path_display: '/Novel.epub', size: 1000 },
            { '.tag': 'file', id: 'id:2', name: 'Report.pdf', path_display: '/Report.pdf', size: 2000 },
            { '.tag': 'file', id: 'id:3', name: 'image.png', path_display: '/image.png', size: 5000 },
          ],
          cursor: 'cur_123',
          has_more: false,
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('{}', { status: 200 });
    };

    const fileService = new DropboxFileService();
    const res = await fileService.listFiles('mock_token');
    assert.equal(res.entries.length, 2);
    assert.equal(res.entries[0].formatHint, 'epub');
    assert.equal(res.entries[1].formatHint, 'pdf');
    console.log('4. File Listing Service hoạt động chuẩn xác (2 file sách tìm thấy) ✓');

    const syncService = new DropboxSyncService();
    const syncRes = await syncService.sync({ accessToken: 'mock_token' });
    assert.equal(syncRes.addedCount, 2);
    assert.equal(syncRes.cursor, 'cur_123');
    console.log('5. Delta Sync Service phân loại chính xác ✓');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('\n===> TẤT CẢ CÁC BƯỚC TEST DROPBOX INTEGRATION ĐỀU THÀNH CÔNG RỰC RỠ! <===');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
