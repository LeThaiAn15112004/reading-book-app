import assert from 'node:assert/strict';
import {
  CompositeExternalLibraryConnector,
  DefaultExternalLibraryRepository,
  MemoryExternalLibraryStorage,
  GoogleDriveLibraryAdapter,
  GoogleBooksLibraryAdapter,
  AppleBooksLibraryAdapter,
} from '../index.ts';

async function runTests() {
  console.log('--- Bắt đầu kiểm thử T8.1 External Library Connectors & Adapters ---');

  const storage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(storage);

  // Mock File Scanner
  const mockFileScanner = {
    async scanDirectory(dir) {
      return [
        { name: 'Clean Code.epub', path: `${dir}/Clean Code.epub`, size: 1024000 },
        { name: 'Architecture.pdf', path: `${dir}/Architecture.pdf`, size: 2048000 },
        { name: 'Notes.txt', path: `${dir}/Notes.txt`, size: 4096 },
        { name: 'Guide.md', path: `${dir}/Guide.md`, size: 8192 },
        { name: 'Ignored.exe', path: `${dir}/Ignored.exe`, size: 500000 },
      ];
    },
  };

  const connector = new CompositeExternalLibraryConnector({
    repository,
    fileScanner: mockFileScanner,
  });

  // 1. Kiểm tra danh sách Providers
  const providers = connector.listProviders();
  console.log('1. Providers:', providers);
  assert.deepEqual(providers, ['google_drive', 'google_books', 'apple_books']);

  // 2. Kiểm tra trạng thái ban đầu (unlinked)
  const initialStatus = await connector.getAllProvidersInfo();
  assert.equal(initialStatus.google_drive.status, 'unlinked');
  assert.equal(initialStatus.google_books.status, 'unlinked');
  assert.equal(initialStatus.apple_books.status, 'unlinked');
  console.log('2. Trạng thái ban đầu: Tất cả unlinked ✓');

  // 3. Test Connection
  const driveTest = await connector.testConnection('google_drive', {
    folderPath: 'C:/Users/Test/GoogleDrive',
  });
  assert.equal(driveTest.success, true);
  console.log('3. Test Connection Google Drive:', driveTest.message, '✓');

  const booksTest = await connector.testConnection('google_books', {
    apiKey: 'xxx',
  });
  assert.equal(booksTest.success, true);
  console.log('3. Test Connection Google Books:', booksTest.message, '✓');

  // 4. Link Google Drive (Folder-first)
  const linkedDrive = await connector.link('google_drive', {
    folderPath: 'C:/Users/Test/GoogleDrive',
  });
  assert.equal(linkedDrive.status, 'linked');
  assert.equal(linkedDrive.itemCount, 4); // 4 supported book formats (epub, pdf, txt, md)
  console.log('4. Link Google Drive thành công:', linkedDrive.itemCount, 'tài liệu tìm thấy ✓');

  // 5. Pull Catalog from Google Drive
  const driveCatalog = await connector.pullCatalog('google_drive');
  assert.equal(driveCatalog.length, 4);
  assert.equal(driveCatalog[0].title, 'Clean Code');
  assert.equal(driveCatalog[0].formatHint, 'epub');
  console.log('5. Pull Catalog Google Drive thành công: 4/4 files hợp lệ ✓');

  // 6. Link Google Books (API mode với key 'xxx')
  const linkedBooks = await connector.link('google_books', {
    apiKey: 'xxx',
    query: 'science fiction',
  });
  assert.equal(linkedBooks.status, 'linked');
  console.log('6. Link Google Books thành công với key placeholder xxx ✓');

  const booksCatalog = await connector.pullCatalog('google_books');
  assert.ok(booksCatalog.length > 0);
  console.log('6. Pull Catalog Google Books:', booksCatalog.length, 'sách ✓');

  // 7. Link Apple Books
  const linkedApple = await connector.link('apple_books', {
    folderPath: 'C:/Users/Test/AppleBooks',
  });
  assert.equal(linkedApple.status, 'linked');
  const appleCatalog = await connector.pullCatalog('apple_books');
  assert.equal(appleCatalog.length, 4);
  console.log('7. Link & Pull Apple Books thành công ✓');

  // 8. Unlink Google Drive (đảm bảo không ảnh hưởng tới các provider khác)
  await connector.unlink('google_drive');
  const postUnlinkInfo = await connector.getProviderInfo('google_drive');
  assert.equal(postUnlinkInfo.status, 'unlinked');

  const booksStillLinked = await connector.getProviderInfo('google_books');
  assert.equal(booksStillLinked.status, 'linked');
  console.log('8. Unlink Google Drive thành công, các nguồn khác vẫn an toàn ✓');

  console.log('\n===> TẤT CẢ CÁC BƯỚC TEST T8.1 ĐỀU ĐẠT CHUẨN THÀNH CÔNG! <===');
}

runTests().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
