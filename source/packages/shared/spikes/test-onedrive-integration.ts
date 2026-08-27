import assert from 'node:assert/strict';
import {
  CompositeExternalLibraryConnector,
  DefaultExternalLibraryRepository,
  MemoryExternalLibraryStorage,
  OneDriveAuthService,
  OneDriveFileService,
  OneDriveDownloadService,
  OneDriveSyncService,
  MemoryOneDriveTokenStore,
  generateOneDrivePkcePair,
  detectOneDriveBookFormat,
  isSupportedOneDriveBookFile,
  createMsalConfig,
  ONEDRIVE_DEFAULT_CLIENT_ID,
  ONEDRIVE_DEFAULT_TENANT_ID,
  type OneDriveFileMetadata,
} from '../index.js';

async function runTests() {
  console.log('\n=== Bắt đầu kiểm thử Microsoft OneDrive Synchronization & Integration ===\n');

  // ─── 1. PKCE Generation ──────────────────────────────────────────────────
  const { codeVerifier, codeChallenge } = await generateOneDrivePkcePair();
  assert.ok(codeVerifier.length >= 43, 'codeVerifier should be >= 43 chars');
  assert.ok(codeChallenge.length > 0, 'codeChallenge should not be empty');
  assert.ok(!/[+/=]/.test(codeChallenge), 'codeChallenge must be Base64URL encoded (no + / =)');
  console.log('1. PKCE generation verified (S256 code_challenge) ✓');

  // ─── 2. MSAL Config & Auth URL Builder ───────────────────────────────────
  const msalConfig = createMsalConfig();
  assert.equal(msalConfig.auth.clientId, ONEDRIVE_DEFAULT_CLIENT_ID);
  assert.ok(msalConfig.auth.authority.includes('login.microsoftonline.com'));
  console.log('2a. MSAL config helper verified ✓');

  const authService = new OneDriveAuthService();
  assert.equal(authService.getClientId(), ONEDRIVE_DEFAULT_CLIENT_ID);
  assert.equal(authService.getTenantId(), ONEDRIVE_DEFAULT_TENANT_ID);

  const authUrl = authService.getAuthorizationUrl({
    state: 'security-state-123',
    codeChallenge,
  });
  const parsedUrl = new URL(authUrl);
  assert.equal(parsedUrl.searchParams.get('client_id'), ONEDRIVE_DEFAULT_CLIENT_ID);
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('code_challenge'), codeChallenge);
  assert.equal(parsedUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(parsedUrl.searchParams.get('scope')?.includes('Files.ReadWrite'));
  assert.ok(parsedUrl.searchParams.get('scope')?.includes('offline_access'));
  console.log('2b. Microsoft OAuth2 PKCE authorization URL verified ✓');

  // ─── 3. Token Store Lifecycle ────────────────────────────────────────────
  const tokenStore = new MemoryOneDriveTokenStore();
  assert.equal(await tokenStore.getTokens(), null);
  assert.equal(await tokenStore.hasValidToken(), false);

  await tokenStore.saveTokens({
    accessToken: 'mock_ms_access_token',
    refreshToken: 'mock_ms_refresh_token',
    expiresAt: Date.now() + 3600_000,
    tokenType: 'Bearer',
  });
  assert.equal((await tokenStore.getTokens())?.accessToken, 'mock_ms_access_token');
  assert.equal(await tokenStore.hasValidToken(), true);

  await tokenStore.clearTokens();
  assert.equal(await tokenStore.getTokens(), null);
  assert.equal(await tokenStore.hasValidToken(), false);
  console.log('3. Token store lifecycle (save/get/validate/clear) verified ✓');

  // ─── 4. Book Format Detection & Filtering ────────────────────────────────
  assert.equal(detectOneDriveBookFormat('novel.epub', 'application/epub+zip'), 'epub');
  assert.equal(detectOneDriveBookFormat('paper.pdf', 'application/pdf'), 'pdf');
  assert.equal(detectOneDriveBookFormat('notes.txt', 'text/plain'), 'txt');
  assert.equal(detectOneDriveBookFormat('guide.mobi', 'application/x-mobipocket-ebook'), 'mobi');
  assert.equal(detectOneDriveBookFormat('doc.docx'), 'docx');

  assert.equal(isSupportedOneDriveBookFile('story.epub'), true);
  assert.equal(isSupportedOneDriveBookFile('story.mobi'), true);
  assert.equal(isSupportedOneDriveBookFile('song.mp3'), false);
  assert.equal(isSupportedOneDriveBookFile('video.mp4'), false);
  console.log('4. Book format detection and format filter verified (.epub, .pdf, .txt, .mobi, .docx) ✓');

  // ─── 5. Composite Connector Provider Listing ─────────────────────────────
  const storage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(storage);
  const connector = new CompositeExternalLibraryConnector({ repository });

  const providers = connector.listProviders();
  assert.deepEqual(providers, ['google_drive', 'dropbox', 'onedrive']);
  console.log('5. Composite connector lists all 3 providers:', providers, '✓');

  // ─── 6. OneDrive Link & Pull Catalog in Local/Sample Mode ────────────────
  const mockFileScanner = {
    async scanDirectory(dir: string) {
      return [
        { name: 'Designing Data-Intensive Applications.epub', path: `${dir}/DDIA.epub`, size: 2048000 },
        { name: 'Computer Networking.pdf', path: `${dir}/Networking.pdf`, size: 4096000 },
        { name: 'Kindle Book.mobi', path: `${dir}/Kindle.mobi`, size: 1024000 },
        { name: 'Notes.txt', path: `${dir}/Notes.txt`, size: 2048 },
        { name: 'Archive.zip', path: `${dir}/Archive.zip`, size: 50000000 },
      ];
    },
  };

  const connectorWithScanner = new CompositeExternalLibraryConnector({
    repository,
    fileScanner: mockFileScanner,
  });

  const linked = await connectorWithScanner.link('onedrive', {
    folderPath: 'C:/Users/OneDriveSync',
  });
  assert.equal(linked.status, 'linked');
  assert.equal(linked.itemCount, 4); // 4 supported formats: epub, pdf, mobi, txt

  const catalog = await connectorWithScanner.pullCatalog('onedrive');
  assert.equal(catalog.length, 4);
  assert.equal(catalog[0]?.formatHint, 'epub');
  assert.equal(catalog[2]?.formatHint, 'mobi');
  console.log('6. OneDrive folder link & catalog pull verified (filtered non-book files) ✓');

  // ─── 7. Unlink Provider ──────────────────────────────────────────────────
  await connectorWithScanner.unlink('onedrive');
  const postUnlink = await connectorWithScanner.getProviderInfo('onedrive');
  assert.equal(postUnlink.status, 'unlinked');
  console.log('7. OneDrive unlink verified ✓');

  console.log('\n>>> TẤT CẢ KIỂM THỬ ONEDRIVE ĐÃ THÀNH CÔNG RỰC RỠ! <<<\n');
}

runTests().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
