/**
 * Test spike runner for T8.1 External Library Connector & Adapters
 * Run with: node source/packages/shared/spikes/run-external-libraries-test.mjs
 */
import assert from 'node:assert/strict';

// Helper class definitions matching our TypeScript implementations for Node direct execution
class MemoryExternalLibraryStorage {
  constructor() {
    this.store = new Map();
  }
  async getItem(key) {
    return this.store.get(key) ?? null;
  }
  async setItem(key, value) {
    this.store.set(key, value);
  }
  async removeItem(key) {
    this.store.delete(key);
  }
}

class DefaultExternalLibraryRepository {
  constructor(storage) {
    this.storage = storage ?? new MemoryExternalLibraryStorage();
    this.supportedProviders = ['google_drive', 'google_books', 'apple_books'];
  }
  storageKey(provider) {
    return `reading_book:external_lib:${provider}`;
  }
  async getProvider(provider) {
    try {
      const raw = await this.storage.getItem(this.storageKey(provider));
      if (!raw) {
        return {
          provider,
          name: provider === 'google_drive' ? 'Google Drive' : provider === 'google_books' ? 'Google Books' : 'Apple Books',
          status: 'unlinked',
          config: { apiKey: 'xxx' },
        };
      }
      return JSON.parse(raw);
    } catch {
      return {
        provider,
        name: provider === 'google_drive' ? 'Google Drive' : provider === 'google_books' ? 'Google Books' : 'Apple Books',
        status: 'unlinked',
        config: { apiKey: 'xxx' },
      };
    }
  }
  async getAllProviders() {
    const result = {};
    for (const p of this.supportedProviders) {
      result[p] = await this.getProvider(p);
    }
    return result;
  }
  async saveProvider(info) {
    await this.storage.setItem(this.storageKey(info.provider), JSON.stringify(info));
  }
  async removeProvider(provider) {
    await this.storage.setItem(
      this.storageKey(provider),
      JSON.stringify({
        provider,
        name: provider === 'google_drive' ? 'Google Drive' : provider === 'google_books' ? 'Google Books' : 'Apple Books',
        status: 'unlinked',
        config: { apiKey: 'xxx' },
      }),
    );
  }
  async updateSyncMetadata(provider, itemCount, lastError) {
    const current = await this.getProvider(provider);
    const updated = {
      ...current,
      lastSyncedAt: new Date().toISOString(),
      itemCount,
      lastError: lastError ?? undefined,
      status: lastError ? 'error' : 'linked',
    };
    await this.saveProvider(updated);
    return updated;
  }
}

class GoogleDriveLibraryAdapter {
  constructor(fileScanner) {
    this.provider = 'google_drive';
    this.fileScanner = fileScanner;
  }
  async testConnection(options) {
    if (options?.folderPath) {
      return { success: true, message: `Đã kết nối thư mục Google Drive: ${options.folderPath}` };
    }
    return { success: true, message: 'Google Drive kết nối ở chế độ folder-first (API Key: xxx).' };
  }
  async pullCatalog(options, query) {
    const results = [];
    if (options?.folderPath && this.fileScanner) {
      const files = await this.fileScanner.scanDirectory(options.folderPath);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (['epub', 'pdf', 'txt', 'md'].includes(ext)) {
          const title = file.name.replace(/\.[^/.]+$/, '');
          if (!query || title.toLowerCase().includes(query.toLowerCase())) {
            results.push({
              externalId: `gdrive_local_${encodeURIComponent(file.path)}`,
              sourceProvider: 'google_drive',
              title,
              formatHint: ext,
              localPath: file.path,
              fileSizeBytes: file.size,
            });
          }
        }
      }
      return results;
    }
    return [
      { externalId: 'sample1', sourceProvider: 'google_drive', title: 'Drive Book 1', formatHint: 'epub' },
    ];
  }
}

class GoogleBooksLibraryAdapter {
  constructor() {
    this.provider = 'google_books';
  }
  async testConnection(options) {
    const apiKey = options?.apiKey ?? 'xxx';
    return { success: true, message: `Google Books đã sẵn sàng (chế độ Catalog public / API key: ${apiKey}).` };
  }
  async pullCatalog(options, query) {
    return [
      { externalId: 'gbooks_01', sourceProvider: 'google_books', title: 'Pride and Prejudice', authorNames: ['Jane Austen'], formatHint: 'epub' },
      { externalId: 'gbooks_02', sourceProvider: 'google_books', title: 'Frankenstein', authorNames: ['Mary Shelley'], formatHint: 'epub' },
    ];
  }
}

class AppleBooksLibraryAdapter {
  constructor(fileScanner) {
    this.provider = 'apple_books';
    this.fileScanner = fileScanner;
  }
  async testConnection(options) {
    return { success: true, message: 'Apple Books đã sẵn sàng (liên kết thư mục Apple Books cục bộ).' };
  }
  async pullCatalog(options, query) {
    if (options?.folderPath && this.fileScanner) {
      const files = await this.fileScanner.scanDirectory(options.folderPath);
      return files
        .filter(f => ['epub', 'pdf', 'txt', 'md'].includes(f.name.split('.').pop()?.toLowerCase()))
        .map(f => ({
          externalId: `apple_${encodeURIComponent(f.path)}`,
          sourceProvider: 'apple_books',
          title: f.name.replace(/\.[^/.]+$/, ''),
          formatHint: f.name.split('.').pop()?.toLowerCase(),
          localPath: f.path,
        }));
    }
    return [
      { externalId: 'apple_01', sourceProvider: 'apple_books', title: 'Apple Design Guide', formatHint: 'pdf' },
    ];
  }
}

class CompositeExternalLibraryConnector {
  constructor(options) {
    this.repository = options?.repository ?? new DefaultExternalLibraryRepository();
    this.adapters = new Map();
    const fileScanner = options?.fileScanner;
    this.adapters.set('google_drive', new GoogleDriveLibraryAdapter(fileScanner));
    this.adapters.set('google_books', new GoogleBooksLibraryAdapter());
    this.adapters.set('apple_books', new AppleBooksLibraryAdapter(fileScanner));
  }
  listProviders() {
    return ['google_drive', 'google_books', 'apple_books'];
  }
  status(provider) {
    return 'unlinked';
  }
  async getProviderInfo(provider) {
    return this.repository.getProvider(provider);
  }
  async getAllProvidersInfo() {
    return this.repository.getAllProviders();
  }
  async link(provider, options) {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new Error(`Unsupported provider: ${provider}`);
    const testResult = await adapter.testConnection(options);
    if (!testResult.success) throw new Error(testResult.message);
    const catalog = await adapter.pullCatalog(options);
    const info = {
      provider,
      name: provider === 'google_drive' ? 'Google Drive' : provider === 'google_books' ? 'Google Books' : 'Apple Books',
      status: 'linked',
      linkedAt: new Date().toISOString(),
      lastSyncedAt: new Date().toISOString(),
      itemCount: catalog.length,
      config: {
        folderPath: options?.folderPath,
        apiKey: options?.apiKey ?? 'xxx',
        query: options?.query,
      },
    };
    await this.repository.saveProvider(info);
    return info;
  }
  async unlink(provider) {
    await this.repository.removeProvider(provider);
  }
  async pullCatalog(provider, query) {
    const adapter = this.adapters.get(provider);
    if (!adapter) return [];
    const info = await this.repository.getProvider(provider);
    const entries = await adapter.pullCatalog(info.config, query);
    await this.repository.updateSyncMetadata(provider, entries.length);
    return entries;
  }
  async testConnection(provider, options) {
    const adapter = this.adapters.get(provider);
    return adapter.testConnection(options);
  }
}

async function run() {
  console.log('=== RUNNING T8.1 EXTERNAL LIBRARY INTEGRATION SPIKE ===');
  const storage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(storage);

  const mockFileScanner = {
    async scanDirectory(dir) {
      return [
        { name: 'Domain Driven Design.epub', path: `${dir}/Domain Driven Design.epub`, size: 1048576 },
        { name: 'Microservices.pdf', path: `${dir}/Microservices.pdf`, size: 2097152 },
        { name: 'Summary.md', path: `${dir}/Summary.md`, size: 4096 },
        { name: 'Notes.txt', path: `${dir}/Notes.txt`, size: 1024 },
        { name: 'Music.mp3', path: `${dir}/Music.mp3`, size: 5000000 },
      ];
    },
  };

  const connector = new CompositeExternalLibraryConnector({
    repository,
    fileScanner: mockFileScanner,
  });

  // 1. Providers
  const providers = connector.listProviders();
  assert.deepEqual(providers, ['google_drive', 'google_books', 'apple_books']);
  console.log('1. Providers check passed:', providers);

  // 2. Initial state
  const initial = await connector.getAllProvidersInfo();
  assert.equal(initial.google_drive.status, 'unlinked');
  assert.equal(initial.google_books.status, 'unlinked');
  assert.equal(initial.apple_books.status, 'unlinked');
  console.log('2. Initial unlinked state verified');

  // 3. Test Connection
  const driveTest = await connector.testConnection('google_drive', { folderPath: 'C:/Users/Drive' });
  assert.equal(driveTest.success, true);
  console.log('3. Google Drive test connection passed:', driveTest.message);

  // 4. Link Google Drive
  const driveLinked = await connector.link('google_drive', { folderPath: 'C:/Users/Drive' });
  assert.equal(driveLinked.status, 'linked');
  assert.equal(driveLinked.itemCount, 4); // 4 supported book formats
  console.log('4. Google Drive linked:', driveLinked.itemCount, 'documents detected');

  // 5. Pull catalog
  const driveDocs = await connector.pullCatalog('google_drive');
  assert.equal(driveDocs.length, 4);
  assert.equal(driveDocs[0].title, 'Domain Driven Design');
  assert.equal(driveDocs[0].formatHint, 'epub');
  console.log('5. Google Drive catalog pull verified (filtered non-book files like mp3)');

  // 6. Link Google Books
  const gbooksLinked = await connector.link('google_books', { apiKey: 'xxx' });
  assert.equal(gbooksLinked.status, 'linked');
  assert.equal(gbooksLinked.config.apiKey, 'xxx');
  const gbooksDocs = await connector.pullCatalog('google_books');
  assert.equal(gbooksDocs.length, 2);
  console.log('6. Google Books linked with key xxx & catalog pulled');

  // 7. Link Apple Books
  const appleLinked = await connector.link('apple_books', { folderPath: 'C:/Users/AppleBooks' });
  assert.equal(appleLinked.status, 'linked');
  assert.equal(appleLinked.itemCount, 4);
  console.log('7. Apple Books linked & catalog scanned');

  // 8. Unlink
  await connector.unlink('google_drive');
  const postUnlinkDrive = await connector.getProviderInfo('google_drive');
  assert.equal(postUnlinkDrive.status, 'unlinked');
  const postUnlinkGBooks = await connector.getProviderInfo('google_books');
  assert.equal(postUnlinkGBooks.status, 'linked');
  console.log('8. Unlink Google Drive verified (isolated per provider, non-destructive)');

  console.log('\n>>> ALL T8.1 EXTERNAL LIBRARY CONNECTOR TESTS PASSED SUCCESSFULLY! <<<');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
