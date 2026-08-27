import assert from 'node:assert/strict';
import {
  CompositeExternalLibraryConnector,
  DefaultExternalLibraryRepository,
  MemoryExternalLibraryStorage,
  GoogleDriveAuthService,
  GoogleDriveFileService,
  GoogleDriveDownloadService,
  GoogleDriveSyncService,
  MemoryGoogleDriveTokenStore,
  generateGoogleDrivePkcePair,
  detectBookFormat,
  isSupportedBookFile,
  GOOGLE_DRIVE_SUPPORTED_BOOK_EXTENSIONS,
  type GoogleDriveFileMetadata,
  type GoogleDriveDownloadResult,
} from '../index.js';

async function runTests() {
  console.log('\n=== Bắt đầu kiểm thử Google Drive Synchronization & Integration ===\n');

  // ─── 1. PKCE Generation ──────────────────────────────────────────────────
  const { codeVerifier, codeChallenge } = await generateGoogleDrivePkcePair();
  assert.ok(codeVerifier.length >= 43);
  assert.ok(codeChallenge.length > 0);
  assert.ok(!/[+/=]/.test(codeChallenge), 'codeChallenge must be Base64URL encoded');
  console.log('1. PKCE generation verified ✓');

  // ─── 2. Auth Service: URL Generation ─────────────────────────────────────
  const authService = new GoogleDriveAuthService({
    credentials: { clientId: 'test-client-id-123.apps.googleusercontent.com' },
  });
  const authUrl = authService.getAuthorizationUrl({
    redirectUri: 'http://localhost:3000/callback',
    codeChallenge,
    state: 'security-state-abc',
  });
  const parsedUrl = new URL(authUrl);
  assert.equal(parsedUrl.searchParams.get('client_id'), 'test-client-id-123.apps.googleusercontent.com');
  assert.equal(parsedUrl.searchParams.get('access_type'), 'offline');
  assert.equal(parsedUrl.searchParams.get('prompt'), 'consent');
  assert.equal(parsedUrl.searchParams.get('code_challenge'), codeChallenge);
  assert.equal(parsedUrl.searchParams.get('code_challenge_method'), 'S256');
  console.log('2. OAuth2 authorization URL parameters verified ✓');

  // ─── 3. Token Store Lifecycle ────────────────────────────────────────────
  const tokenStore = new MemoryGoogleDriveTokenStore();
  assert.equal(await tokenStore.getTokens(), null);
  assert.equal(await tokenStore.hasValidToken(), false);

  await tokenStore.saveTokens({
    accessToken: 'ya29.mock_token',
    refreshToken: 'mock_refresh',
    expiresAt: Date.now() + 3600_000,
    tokenType: 'Bearer',
  });
  assert.equal((await tokenStore.getTokens())?.accessToken, 'ya29.mock_token');
  assert.equal(await tokenStore.hasValidToken(), true);

  await tokenStore.clearTokens();
  assert.equal(await tokenStore.getTokens(), null);
  assert.equal(await tokenStore.hasValidToken(), false);
  console.log('3. Token store lifecycle (save/get/validate/clear) verified ✓');

  // ─── 4. Book Format Detection & Filtering ────────────────────────────────
  assert.equal(detectBookFormat('novel.epub', 'application/epub+zip'), 'epub');
  assert.equal(detectBookFormat('report.pdf', 'application/pdf'), 'pdf');
  assert.equal(detectBookFormat('notes.txt', 'text/plain'), 'txt');
  assert.equal(detectBookFormat('readme.md', 'text/markdown'), 'md');
  assert.equal(detectBookFormat('document.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), 'docx');
  assert.equal(detectBookFormat('legacy.doc', 'application/msword'), 'doc');

  assert.equal(isSupportedBookFile('test.epub', 'application/epub+zip'), true);
  assert.equal(isSupportedBookFile('test.pdf', 'application/pdf'), true);
  assert.equal(isSupportedBookFile('image.jpg', 'image/jpeg'), false);
  assert.equal(isSupportedBookFile('song.mp3', 'audio/mpeg'), false);
  console.log('4. Book format detection and format filter verified ✓');

  // ─── 5. Composite Connector Provider Listing ─────────────────────────────
  const storage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(storage);
  const connector = new CompositeExternalLibraryConnector({ repository });

  const providers = connector.listProviders();
  assert.deepEqual(providers, ['google_drive', 'dropbox', 'onedrive']);
  assert.ok(!providers.includes('google_books' as any), 'google_books must be completely removed');
  console.log('5. Providers list check: google_drive, dropbox, and onedrive exist ✓');

  // ─── 6. Google Drive Link & Pull Catalog in Sample / Local Mode ──────────
  const mockFileScanner = {
    async scanDirectory(dir: string) {
      return [
        { name: 'Book1.epub', path: `${dir}/Book1.epub`, size: 1048576 },
        { name: 'Book2.pdf', path: `${dir}/Book2.pdf`, size: 2097152 },
        { name: 'Ignore.exe', path: `${dir}/Ignore.exe`, size: 999999 },
      ];
    },
  };

  const connectorWithScanner = new CompositeExternalLibraryConnector({
    repository,
    fileScanner: mockFileScanner,
  });

  const linked = await connectorWithScanner.link('google_drive', {
    folderPath: 'C:/Users/DriveSync',
  });
  assert.equal(linked.status, 'linked');
  assert.equal(linked.itemCount, 2);

  const catalog = await connectorWithScanner.pullCatalog('google_drive');
  assert.equal(catalog.length, 2);
  assert.equal(catalog[0]?.formatHint, 'epub');
  assert.equal(catalog[1]?.formatHint, 'pdf');
  console.log('6. Google Drive folder link & catalog pull verified (filtered non-book files) ✓');

  // ─── 7. Unlink Provider ──────────────────────────────────────────────────
  await connectorWithScanner.unlink('google_drive');
  const postUnlink = await connectorWithScanner.getProviderInfo('google_drive');
  assert.equal(postUnlink.status, 'unlinked');
  console.log('7. Google Drive unlink verified ✓');

  console.log('\n>>> TẤT CẢ KIỂM THỬ GOOGLE DRIVE ĐÃ THÀNH CÔNG RỰC RỠ! <<<\n');
}

runTests().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
