import assert from 'node:assert/strict';
import {
  CompositeExternalLibraryConnector,
  DefaultExternalLibraryRepository,
  MemoryExternalLibraryStorage,
} from '../index.js';

async function runTests() {
  console.log('--- Bắt đầu kiểm thử T8.1 External Library Connectors & Adapters ---');

  const storage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(storage);

  // Mock File Scanner for folder-first mode
  const mockFileScanner = {
    async scanDirectory(dir: string) {
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

  // 1. Providers list — 3 supported cloud storage providers
  const providers = connector.listProviders();
  console.log('1. Providers:', providers);
  assert.deepEqual(providers, ['google_drive', 'dropbox', 'onedrive']);

  // 2. Initial status (unlinked)
  const initialStatus = await connector.getAllProvidersInfo();
  assert.equal(initialStatus.google_drive.status, 'unlinked');
  assert.equal(initialStatus.dropbox.status, 'unlinked');
  assert.equal(initialStatus.onedrive.status, 'unlinked');
  console.log('2. Trạng thái ban đầu: Tất cả unlinked ✓');

  // 3. Test Connection Google Drive
  const driveTest = await connector.testConnection('google_drive', {
    folderPath: 'C:/Users/Test/GoogleDrive',
  });
  assert.equal(driveTest.success, true);
  console.log('3. Test Connection Google Drive:', driveTest.message, '✓');

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
  assert.equal(driveCatalog[0]?.title, 'Clean Code');
  assert.equal(driveCatalog[0]?.formatHint, 'epub');
  console.log('5. Pull Catalog Google Drive thành công: 4/4 files hợp lệ ✓');

  // 6. Dropbox link + catalog (sample mode with 'xxx' key)
  const linkedDropbox = await connector.link('dropbox', { apiKey: 'xxx' });
  assert.equal(linkedDropbox.status, 'linked');
  console.log('6. Link Dropbox thành công ✓');

  const dropboxCatalog = await connector.pullCatalog('dropbox');
  assert.ok(dropboxCatalog.length > 0);
  console.log('6. Pull Catalog Dropbox:', dropboxCatalog.length, 'sách ✓');

  // 7. Unlink Google Drive — should not affect Dropbox
  await connector.unlink('google_drive');
  const postUnlinkInfo = await connector.getProviderInfo('google_drive');
  assert.equal(postUnlinkInfo.status, 'unlinked');

  const dropboxStillLinked = await connector.getProviderInfo('dropbox');
  assert.equal(dropboxStillLinked.status, 'linked');
  console.log('7. Unlink Google Drive thành công, Dropbox vẫn an toàn ✓');

  console.log('\n===> TẤT CẢ CÁC BƯỚC TEST T8.1 ĐỀU ĐẠT CHUẨN THÀNH CÔNG! <===');
}

runTests().catch((err) => {
  console.error('Test thất bại:', err);
  process.exit(1);
});
