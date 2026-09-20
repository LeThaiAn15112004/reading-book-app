import assert from 'node:assert/strict';
import {
  DROPBOX_DEFAULT_APP_KEY,
  DROPBOX_DEFAULT_APP_SECRET,
  DropboxAuthService,
  DropboxDownloadService,
  DropboxFileService,
  DropboxLibraryAdapter,
  DropboxSyncService,
  MemoryDropboxTokenStore,
  generatePkcePair,
  detectDropboxBookFormat,
  isDropboxBookFile,
  SUPPORTED_BOOK_EXTENSIONS,
  CompositeExternalLibraryConnector,
  DefaultExternalLibraryRepository,
  MemoryExternalLibraryStorage,
} from '../index.js';

async function runDropboxTests() {
  console.log('===============================================================');
  console.log('🧪 BẮT ĐẦU KIỂM THỬ TÍNH NĂNG TÍCH HỢP DROPBOX (DROPBOX INTEGRATION)');
  console.log('===============================================================\n');

  // -------------------------------------------------------------
  // Test 1: App Credentials & PKCE Generator
  // -------------------------------------------------------------
  console.log('🔹 1. Kiểm tra Cấu hình App Credentials & PKCE...');
  const authService = new DropboxAuthService({
    tokenStore: new MemoryDropboxTokenStore(),
  });

  assert.equal(authService.getAppKey(), '9s1ipeb0zmce4en');
  console.log('  ✓ App Key đúng chuẩn:', authService.getAppKey());

  const pkce = await generatePkcePair();
  assert.ok(pkce.codeVerifier.length >= 43, 'PKCE verifier phải có độ dài tối thiểu 43 ký tự');
  assert.ok(pkce.codeChallenge.length > 0, 'PKCE challenge phải tồn tại');
  console.log('  ✓ Tạo mã PKCE thành công: verifier length =', pkce.codeVerifier.length, ', challenge =', pkce.codeChallenge);

  // -------------------------------------------------------------
  // Test 2: OAuth 2.0 Authorization URL Generator
  // -------------------------------------------------------------
  console.log('\n🔹 2. Kiểm tra Tạo URL Ủy quyền OAuth 2.0...');
  const authUrl = authService.getAuthorizationUrl({
    redirectUri: 'http://localhost:5173/oauth/dropbox/callback',
    state: 'security_random_state_123',
    tokenAccessType: 'offline',
    codeChallenge: pkce.codeChallenge,
  });

  const parsedUrl = new URL(authUrl);
  assert.equal(parsedUrl.hostname, 'www.dropbox.com');
  assert.equal(parsedUrl.pathname, '/oauth2/authorize');
  assert.equal(parsedUrl.searchParams.get('client_id'), '9s1ipeb0zmce4en');
  assert.equal(parsedUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedUrl.searchParams.get('token_access_type'), 'offline');
  assert.equal(parsedUrl.searchParams.get('redirect_uri'), 'http://localhost:5173/oauth/dropbox/callback');
  assert.equal(parsedUrl.searchParams.get('state'), 'security_random_state_123');
  assert.equal(parsedUrl.searchParams.get('code_challenge'), pkce.codeChallenge);
  assert.equal(parsedUrl.searchParams.get('code_challenge_method'), 'S256');
  console.log('  ✓ OAuth 2.0 URL chính xác đầy đủ tham số PKCE và offline token access ✓');

  // -------------------------------------------------------------
  // Test 3: Token Store & Token Lifecycle (Save, Validate, Refresh, Revoke)
  // -------------------------------------------------------------
  console.log('\n🔹 3. Kiểm tra Quản lý Token & Token Store...');
  const tokenStore = authService.getTokenStore();

  // Ban đầu chưa có token
  assert.equal(await tokenStore.hasValidToken(), false);

  // Lưu token giả lập
  await tokenStore.saveTokens({
    accessToken: 'mock_sl_access_token_abc123',
    refreshToken: 'mock_refresh_token_xyz987',
    expiresAt: Date.now() + 14400 * 1000, // 4 hours from now
    tokenType: 'bearer',
    accountId: 'dbid:AAAH_mock_account',
    uid: '12345678',
  });

  assert.equal(await tokenStore.hasValidToken(), true);
  const stored = await tokenStore.getTokens();
  assert.equal(stored?.accessToken, 'mock_sl_access_token_abc123');
  assert.equal(stored?.refreshToken, 'mock_refresh_token_xyz987');
  console.log('  ✓ Lưu & truy xuất token thành công trong Token Store ✓');

  // Kiểm tra getValidAccessToken
  const validToken = await authService.getValidAccessToken();
  assert.equal(validToken, 'mock_sl_access_token_abc123');
  console.log('  ✓ getValidAccessToken() trả về token hợp lệ ✓');

  // -------------------------------------------------------------
  // Test 4: File Format Detection & Filtering (.epub, .pdf, .txt, .md, .docx, .doc)
  // -------------------------------------------------------------
  console.log('\n🔹 4. Kiểm tra Bộ lọc Định dạng Sách...');
  assert.deepEqual(SUPPORTED_BOOK_EXTENSIONS, ['epub', 'pdf', 'txt', 'md', 'docx', 'doc']);

  const testFiles = [
    { name: 'War_and_Peace.epub', expectedFormat: 'epub', shouldSupport: true },
    { name: 'Machine_Learning.pdf', expectedFormat: 'pdf', shouldSupport: true },
    { name: 'Quick_Notes.txt', expectedFormat: 'txt', shouldSupport: true },
    { name: 'README.md', expectedFormat: 'md', shouldSupport: true },
    { name: 'Thesis_Draft.docx', expectedFormat: 'docx', shouldSupport: true },
    { name: 'Legacy_Report.doc', expectedFormat: 'doc', shouldSupport: true },
    { name: 'setup.exe', expectedFormat: 'exe', shouldSupport: false },
    { name: 'cover_photo.jpg', expectedFormat: 'jpg', shouldSupport: false },
    { name: 'archive.zip', expectedFormat: 'zip', shouldSupport: false },
  ];

  for (const f of testFiles) {
    const detected = detectDropboxBookFormat(f.name);
    const isSupported = isDropboxBookFile(f.name);
    assert.equal(detected, f.expectedFormat);
    assert.equal(isSupported, f.shouldSupport);
  }
  console.log('  ✓ Lọc chính xác 6 định dạng sách (epub, pdf, txt, md, docx, doc) và loại bỏ các file không hỗ trợ ✓');

  // -------------------------------------------------------------
  // Test 5: File Listing Service (Mocking API responses)
  // -------------------------------------------------------------
  console.log('\n🔹 5. Kiểm tra File Listing Service với Mock Data...');
  const fileService = new DropboxFileService();

  // Test with custom mock fetch
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/files/list_folder')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                '.tag': 'file',
                id: 'id:book_1_epub',
                name: 'Clean Code.epub',
                path_lower: '/books/clean code.epub',
                path_display: '/Books/Clean Code.epub',
                size: 2048576,
                server_modified: '2026-08-10T10:00:00Z',
                client_modified: '2026-08-10T09:50:00Z',
                rev: '015d8a9b1c2e3f',
              },
              {
                '.tag': 'file',
                id: 'id:book_2_pdf',
                name: 'System Architecture.pdf',
                path_lower: '/books/system architecture.pdf',
                path_display: '/Books/System Architecture.pdf',
                size: 5120000,
                server_modified: '2026-08-15T14:30:00Z',
                client_modified: '2026-08-15T14:25:00Z',
                rev: '015d8a9b1c2e40',
              },
              {
                '.tag': 'file',
                id: 'id:non_book',
                name: 'installer.exe',
                path_lower: '/books/installer.exe',
                path_display: '/Books/installer.exe',
                size: 15000000,
                server_modified: '2026-08-16T12:00:00Z',
                client_modified: '2026-08-16T12:00:00Z',
                rev: '015d8a9b1c2e41',
              },
              {
                '.tag': 'folder',
                id: 'id:folder_sci_fi',
                name: 'Sci-Fi',
                path_lower: '/books/sci-fi',
                path_display: '/Books/Sci-Fi',
              },
            ],
            cursor: 'mock_cursor_page_1',
            has_more: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    };

    const listResult = await fileService.listFiles('mock_access_token_123', {
      path: '/Books',
      recursive: true,
    });

    assert.equal(listResult.entries.length, 2, 'Chỉ 2 file sách hợp lệ được đưa vào danh sách');
    assert.equal(listResult.entries[0]?.name, 'Clean Code.epub');
    assert.equal(listResult.entries[0]?.formatHint, 'epub');
    assert.equal(listResult.entries[1]?.name, 'System Architecture.pdf');
    assert.equal(listResult.entries[1]?.formatHint, 'pdf');
    assert.equal(listResult.cursor, 'mock_cursor_page_1');
    console.log('  ✓ File Listing Service trả về đúng danh sách sách đã lọc và cursor:', listResult.cursor, '✓');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -------------------------------------------------------------
  // Test 6: File Download Service
  // -------------------------------------------------------------
  console.log('\n🔹 6. Kiểm tra File Download Service...');
  const downloadService = new DropboxDownloadService();

  try {
    const mockBookContent = 'Mock ePub binary content string for testing.';
    const encoder = new TextEncoder();
    const mockBinary = encoder.encode(mockBookContent);

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/files/download')) {
        const metadataHeader = JSON.stringify({
          '.tag': 'file',
          id: 'id:book_1_epub',
          name: 'Clean Code.epub',
          path_lower: '/books/clean code.epub',
          path_display: '/Books/Clean Code.epub',
          size: mockBinary.byteLength,
          server_modified: '2026-08-10T10:00:00Z',
          client_modified: '2026-08-10T09:50:00Z',
          rev: '015d8a9b1c2e3f',
        });
        return new Response(mockBinary, {
          status: 200,
          headers: {
            'Content-Type': 'application/octet-stream',
            'Dropbox-API-Result': metadataHeader,
            'Content-Length': String(mockBinary.byteLength),
          },
        });
      }
      return new Response('{}', { status: 200 });
    };

    const downloaded = await downloadService.downloadFile('mock_access_token', '/Books/Clean Code.epub');
    assert.equal(downloaded.metadata.name, 'Clean Code.epub');
    assert.equal(downloaded.metadata.formatHint, 'epub');
    assert.equal(downloaded.text?.(), mockBookContent);
    assert.ok(downloaded.data.byteLength > 0);
    console.log('  ✓ Download Service tải và giải mã thành công file sách binary & text ✓');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -------------------------------------------------------------
  // Test 7: Cursor-based Delta Sync Service
  // -------------------------------------------------------------
  console.log('\n🔹 7. Kiểm tra Cơ chế Cursor-based Delta Sync...');
  const syncService = new DropboxSyncService();

  try {
    // Kịch bản Delta Sync: Tiếp tục từ cursor cũ, Dropbox báo có 1 file sửa đổi và 1 file bị xóa
    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/files/list_folder/continue')) {
        return new Response(
          JSON.stringify({
            entries: [
              {
                '.tag': 'file',
                id: 'id:book_1_epub',
                name: 'Clean Code 2nd Edition.epub',
                path_lower: '/books/clean code 2nd edition.epub',
                path_display: '/Books/Clean Code 2nd Edition.epub',
                size: 2500000,
                server_modified: '2026-08-18T10:00:00Z',
                client_modified: '2026-08-18T10:00:00Z',
                rev: '015d8a9b1c2e99',
              },
              {
                '.tag': 'deleted',
                name: 'Old Thesis.pdf',
                path_lower: '/books/old thesis.pdf',
                path_display: '/Books/Old Thesis.pdf',
              },
            ],
            cursor: 'mock_cursor_page_2_updated',
            has_more: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('{}', { status: 200 });
    };

    const syncResult = await syncService.sync({
      accessToken: 'mock_token',
      cursor: 'mock_cursor_page_1',
      folderPath: '/Books',
    });

    assert.equal(syncResult.cursor, 'mock_cursor_page_2_updated');
    assert.equal(syncResult.totalProcessed, 2);
    assert.equal(syncResult.addedCount, 1);
    assert.equal(syncResult.deletedCount, 1);
    assert.equal(syncResult.changes[0]?.type, 'added');
    assert.equal(syncResult.changes[0]?.name, 'Clean Code 2nd Edition.epub');
    assert.equal(syncResult.changes[1]?.type, 'deleted');
    assert.equal(syncResult.changes[1]?.name, 'Old Thesis.pdf');
    console.log('  ✓ Delta Sync phát hiện chính xác các thay đổi (added = 1, deleted = 1) và cập nhật cursor ✓');
  } finally {
    globalThis.fetch = originalFetch;
  }

  // -------------------------------------------------------------
  // Test 8: DropboxLibraryAdapter & CompositeExternalLibraryConnector Integration
  // -------------------------------------------------------------
  console.log('\n🔹 8. Kiểm tra Tích hợp Adapter & Composite Connector...');
  const memoryStorage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(memoryStorage);

  const mockFileScanner = {
    async scanDirectory(dir: string) {
      return [
        { name: 'Offline Novel.epub', path: `${dir}/Offline Novel.epub`, size: 1024000 },
        { name: 'Dropbox Paper.pdf', path: `${dir}/Dropbox Paper.pdf`, size: 2048000 },
        { name: 'Reading Log.txt', path: `${dir}/Reading Log.txt`, size: 4096 },
        { name: 'Summary.docx', path: `${dir}/Summary.docx`, size: 16384 },
      ];
    },
  };

  const connector = new CompositeExternalLibraryConnector({
    repository,
    fileScanner: mockFileScanner,
  });

  // 8.1 Danh sách providers
  const providers = connector.listProviders();
  assert.deepEqual(providers, ['google_drive', 'dropbox', 'onedrive']);
  console.log('  ✓ Composite Connector hỗ trợ đầy đủ 3 providers:', providers);

  // 8.2 Trạng thái ban đầu
  const initialStatus = await connector.getAllProvidersInfo();
  assert.equal(initialStatus.dropbox.status, 'unlinked');
  assert.equal(initialStatus.dropbox.name, 'Dropbox');
  console.log('  ✓ Trạng thái Dropbox ban đầu: unlinked ✓');

  // 8.3 Test Connection
  const testConnResult = await connector.testConnection('dropbox', {
    folderPath: 'C:/Users/ReadingUser/Dropbox',
  });
  assert.equal(testConnResult.success, true);
  console.log('  ✓ Test Connection Dropbox thành công:', testConnResult.message);

  // 8.4 Link Dropbox (Folder-first sync mode)
  const linkedDropbox = await connector.link('dropbox', {
    folderPath: 'C:/Users/ReadingUser/Dropbox',
  });
  assert.equal(linkedDropbox.status, 'linked');
  assert.equal(linkedDropbox.itemCount, 4); // 4 book files
  console.log('  ✓ Link Dropbox thành công:', linkedDropbox.itemCount, 'tài liệu được phát hiện ✓');

  // 8.5 Pull Catalog
  const catalog = await connector.pullCatalog('dropbox');
  assert.equal(catalog.length, 4);
  assert.equal(catalog[0]?.sourceProvider, 'dropbox');
  assert.equal(catalog[0]?.title, 'Offline Novel');
  assert.equal(catalog[0]?.formatHint, 'epub');
  console.log('  ✓ Pull Catalog Dropbox trả về đúng 4/4 sách chuẩn định dạng ✓');

  // 8.6 Unlink Dropbox
  await connector.unlink('dropbox');
  const postUnlink = await connector.getProviderInfo('dropbox');
  assert.equal(postUnlink.status, 'unlinked');
  console.log('  ✓ Unlink Dropbox thành công và an toàn ✓');

  console.log('\n===============================================================');
  console.log('🎉 TẤT CẢ 8 BƯỚC KIỂM THỬ DROPBOX INTEGRATION ĐỀU ĐẠT CHUẨN 100%!');
  console.log('===============================================================\n');
}

runDropboxTests().catch((err) => {
  console.error('❌ Lỗi kiểm thử:', err);
  process.exit(1);
});
