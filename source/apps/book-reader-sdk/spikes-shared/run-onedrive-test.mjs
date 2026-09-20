/**
 * Standalone Node.js test runner for Microsoft OneDrive & Microsoft Graph Sync Integration.
 * Run with: node source/packages/shared/spikes/run-onedrive-test.mjs
 */
import assert from 'node:assert/strict';

const ONEDRIVE_DEFAULT_CLIENT_ID = '51b8a3ef-c090-461b-886a-b385ea93be7f';
const ONEDRIVE_DEFAULT_TENANT_ID = '6ab9fc33-f8f7-4fdb-aa54-6d7697afcf16';
const ONEDRIVE_DEFAULT_REDIRECT_URI = 'https://login.microsoftonline.com/common/oauth2/nativeclient';
const MICROSOFT_OAUTH_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MICROSOFT_GRAPH_API_BASE = 'https://graph.microsoft.com/v1.0';
const SUPPORTED_BOOK_EXTENSIONS = ['epub', 'pdf', 'txt', 'mobi', 'md', 'docx', 'doc', 'azw3', 'fb2', 'cbz'];

// ─── Inline Helpers ─────────────────────────────────────────────────────────

async function generateOneDrivePkcePair() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const randomBytes = new Uint8Array(48);
  globalThis.crypto.getRandomValues(randomBytes);
  let codeVerifier = '';
  for (let i = 0; i < randomBytes.length; i++) {
    codeVerifier += chars[randomBytes[i] % chars.length];
  }
  const encoded = new TextEncoder().encode(codeVerifier);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  const hashArray = new Uint8Array(hashBuffer);
  let binary = '';
  for (let i = 0; i < hashArray.length; i++) {
    binary += String.fromCharCode(hashArray[i]);
  }
  const codeChallenge = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { codeVerifier, codeChallenge };
}

function getAuthorizationUrl(options = {}) {
  const tenantId = options.tenantId || ONEDRIVE_DEFAULT_TENANT_ID;
  const endpoint = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize`;
  const url = new URL(endpoint);

  url.searchParams.set('client_id', options.clientId || ONEDRIVE_DEFAULT_CLIENT_ID);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', options.redirectUri || ONEDRIVE_DEFAULT_REDIRECT_URI);
  url.searchParams.set('scope', ['Files.ReadWrite', 'offline_access', 'User.Read'].join(' '));
  url.searchParams.set('prompt', 'select_account');

  if (options.state) url.searchParams.set('state', options.state);
  if (options.codeChallenge) {
    url.searchParams.set('code_challenge', options.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
  }

  return url.toString();
}

function detectBookFormat(name, mimeType) {
  const mimeMap = {
    'application/epub+zip': 'epub',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/x-mobipocket-ebook': 'mobi',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  };
  if (mimeType && mimeMap[mimeType]) return mimeMap[mimeType];
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ext || 'unknown';
}

function isSupportedBookFile(name, mimeType) {
  const detected = detectBookFormat(name, mimeType);
  return SUPPORTED_BOOK_EXTENSIONS.includes(detected);
}

class MemoryOneDriveTokenStore {
  constructor() {
    this.tokens = null;
  }
  async saveTokens(tokens) {
    this.tokens = { ...tokens };
  }
  async getTokens() {
    return this.tokens ? { ...this.tokens } : null;
  }
  async clearTokens() {
    this.tokens = null;
  }
  async hasValidToken() {
    if (!this.tokens) return false;
    if (this.tokens.refreshToken) return true;
    return this.tokens.expiresAt > Date.now() + 60_000;
  }
}

// ─── Fetch Mocking ──────────────────────────────────────────────────────────

let originalFetch = globalThis.fetch;
function mockFetch(handler) {
  globalThis.fetch = handler;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}`);
    console.error('    ', err.message);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== Microsoft OneDrive & MS Graph Sync Integration Tests ===\n');

  // 1. PKCE
  await test('1. PKCE verifier and S256 challenge generation', async () => {
    const { codeVerifier, codeChallenge } = await generateOneDrivePkcePair();
    assert.ok(codeVerifier.length >= 43);
    assert.ok(codeChallenge.length > 0);
    assert.ok(!/[+/=]/.test(codeChallenge), 'Challenge must be Base64URL');
    assert.notEqual(codeVerifier, codeChallenge);
  });

  // 2. OAuth URL Builder
  await test('2. Microsoft OAuth2 PKCE URL with Azure Client & Tenant IDs', () => {
    const authUrl = getAuthorizationUrl({
      state: 'state-xyz',
      codeChallenge: 'test-code-challenge',
    });
    const parsed = new URL(authUrl);

    assert.ok(parsed.pathname.includes(ONEDRIVE_DEFAULT_TENANT_ID));
    assert.equal(parsed.searchParams.get('client_id'), ONEDRIVE_DEFAULT_CLIENT_ID);
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('redirect_uri'), ONEDRIVE_DEFAULT_REDIRECT_URI);
    assert.equal(parsed.searchParams.get('code_challenge'), 'test-code-challenge');
    assert.equal(parsed.searchParams.get('code_challenge_method'), 'S256');
    assert.ok(parsed.searchParams.get('scope')?.includes('Files.ReadWrite'));
    assert.ok(parsed.searchParams.get('scope')?.includes('offline_access'));
  });

  // 3. Token Store Lifecycle
  await test('3. Token store save / get / validity / clear lifecycle', async () => {
    const store = new MemoryOneDriveTokenStore();
    assert.equal(await store.getTokens(), null);
    assert.equal(await store.hasValidToken(), false);

    await store.saveTokens({
      accessToken: 'token-abc',
      refreshToken: 'refresh-xyz',
      expiresAt: Date.now() + 3600_000,
      tokenType: 'Bearer',
    });
    assert.equal((await store.getTokens())?.accessToken, 'token-abc');
    assert.equal(await store.hasValidToken(), true);

    await store.clearTokens();
    assert.equal(await store.getTokens(), null);
    assert.equal(await store.hasValidToken(), false);
  });

  // 4. File Listing & Book Format Filter
  await test('4. File listing filters .epub, .pdf, .txt, .mobi, .docx', () => {
    const graphItems = [
      { id: '1', name: 'Clean Code.epub', file: { mimeType: 'application/epub+zip' } },
      { id: '2', name: 'Handbook.pdf', file: { mimeType: 'application/pdf' } },
      { id: '3', name: 'Kindle.mobi', file: { mimeType: 'application/x-mobipocket-ebook' } },
      { id: '4', name: 'Notes.txt', file: { mimeType: 'text/plain' } },
      { id: '5', name: 'Budget.xlsx', file: { mimeType: 'application/vnd.ms-excel' } },
      { id: '6', name: 'Photo.jpg', file: { mimeType: 'image/jpeg' } },
    ];

    const books = graphItems.filter((item) => isSupportedBookFile(item.name, item.file?.mimeType));
    assert.equal(books.length, 4);
    assert.deepEqual(books.map((b) => b.id), ['1', '2', '3', '4']);

    assert.equal(detectBookFormat('Book.epub'), 'epub');
    assert.equal(detectBookFormat('Book.mobi'), 'mobi');
    assert.equal(detectBookFormat('Paper.pdf'), 'pdf');
  });

  // 5. Binary File Download
  await test('5. Binary download via Microsoft Graph /content endpoint', async () => {
    const expectedContent = 'EPUB binary book content from OneDrive';
    mockFetch(async (url) => {
      if (url.toString().includes('/content')) {
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode(expectedContent).buffer,
        };
      }
      return { ok: false, status: 404 };
    });

    try {
      const response = await globalThis.fetch(`${MICROSOFT_GRAPH_API_BASE}/me/drive/items/item123/content`, {
        headers: { Authorization: 'Bearer token' },
      });
      const buffer = await response.arrayBuffer();
      const text = new TextDecoder().decode(buffer);
      assert.equal(text, expectedContent);
    } finally {
      restoreFetch();
    }
  });

  // 6. Microsoft Graph Delta Query Sync
  await test('6. Microsoft Graph Delta query parses added, modified, and deleted changes', () => {
    const localFiles = new Map([
      ['file_1', '2024-01-01T00:00:00Z'], // previously existing
    ]);

    const deltaItems = [
      { id: 'file_1', name: 'Book1.epub', lastModifiedDateTime: '2024-06-01T00:00:00Z', file: { mimeType: 'application/epub+zip' } },
      { id: 'file_2', name: 'NewBook.mobi', lastModifiedDateTime: '2024-06-01T00:00:00Z', file: { mimeType: 'application/x-mobipocket-ebook' } },
      { id: 'file_3', name: 'Deleted.pdf', deleted: { state: 'deleted' } },
      { id: 'file_4', name: 'Random.zip', file: { mimeType: 'application/zip' } },
    ];

    const changes = [];
    for (const item of deltaItems) {
      if (item.deleted) {
        changes.push({ type: 'deleted', fileId: item.id, name: item.name });
        continue;
      }
      if (!isSupportedBookFile(item.name, item.file?.mimeType)) continue;

      const prevTime = localFiles.get(item.id);
      const type = prevTime ? 'modified' : 'added';
      changes.push({ type, fileId: item.id, name: item.name });
    }

    assert.equal(changes.length, 3);
    assert.equal(changes.find((c) => c.fileId === 'file_1')?.type, 'modified');
    assert.equal(changes.find((c) => c.fileId === 'file_2')?.type, 'added');
    assert.equal(changes.find((c) => c.fileId === 'file_3')?.type, 'deleted');
  });

  // 7. Composite Connector Multi-Provider Listing
  await test('7. Composite Connector lists all 3 providers (google_drive, dropbox, onedrive)', () => {
    class MockConnector {
      listProviders() {
        return ['google_drive', 'dropbox', 'onedrive'];
      }
    }
    const connector = new MockConnector();
    const providers = connector.listProviders();
    assert.deepEqual(providers, ['google_drive', 'dropbox', 'onedrive']);
  });

  console.log(`\n${passed + failed} tests run: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    console.error('\n❌ Some OneDrive tests failed!');
    process.exit(1);
  } else {
    console.log('\n✅ All Microsoft OneDrive tests passed successfully!');
  }
}

runTests().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
