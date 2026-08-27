/**
 * Test spike runner for T8.1 External Library Connector & Adapters
 * Run with: node source/packages/shared/spikes/run-external-libraries-test.mjs
 *
 * Updated: google_books removed; Dropbox is now the second supported provider.
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
    this.supportedProviders = ['google_drive', 'dropbox', 'onedrive'];
  }
  storageKey(provider) {
    return `reading_book:external_lib:${provider}`;
  }
  providerDisplayName(provider) {
    const names = { google_drive: 'Google Drive', dropbox: 'Dropbox', onedrive: 'Microsoft OneDrive' };
    return names[provider] ?? provider;
  }
  async getProvider(provider) {
    try {
      const raw = await this.storage.getItem(this.storageKey(provider));
      if (!raw) {
        return {
          provider,
          name: this.providerDisplayName(provider),
          status: 'unlinked',
          config: { apiKey: 'xxx' },
        };
      }
      return JSON.parse(raw);
    } catch {
      return {
        provider,
        name: this.providerDisplayName(provider),
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
        name: this.providerDisplayName(provider),
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
      return { success: true, message: `Connected to local Google Drive folder: ${options.folderPath}` };
    }
    return { success: true, message: 'Google Drive ready (folder-first mode; configure OAuth to enable cloud sync).' };
  }
  async pullCatalog(options, query) {
    const results = [];
    if (options?.folderPath && this.fileScanner) {
      const files = await this.fileScanner.scanDirectory(options.folderPath);
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
        if (['epub', 'pdf', 'txt', 'md', 'docx', 'doc'].includes(ext)) {
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
      { externalId: 'gdrive_sample_01', sourceProvider: 'google_drive', title: 'Google Drive Sample Book', formatHint: 'epub' },
    ];
  }
}

class DropboxLibraryAdapter {
  constructor() {
    this.provider = 'dropbox';
  }
  async testConnection(options) {
    return { success: true, message: `Dropbox ready (token: ${options?.apiKey ?? 'xxx'}).` };
  }
  async pullCatalog() {
    return [
      { externalId: 'dropbox_sample_01', sourceProvider: 'dropbox', title: 'Dropbox Book 1', formatHint: 'epub' },
      { externalId: 'dropbox_sample_02', sourceProvider: 'dropbox', title: 'Dropbox Book 2', formatHint: 'pdf' },
    ];
  }
}

class OneDriveLibraryAdapter {
  constructor() {
    this.provider = 'onedrive';
  }
  async testConnection(options) {
    return { success: true, message: `OneDrive ready (token: ${options?.apiKey ?? 'xxx'}).` };
  }
  async pullCatalog() {
    return [
      { externalId: 'onedrive_sample_01', sourceProvider: 'onedrive', title: 'OneDrive Book 1', formatHint: 'epub' },
    ];
  }
}

class CompositeExternalLibraryConnector {
  constructor(options) {
    this.repository = options?.repository ?? new DefaultExternalLibraryRepository();
    this.adapters = new Map();
    const fileScanner = options?.fileScanner;
    this.adapters.set('google_drive', new GoogleDriveLibraryAdapter(fileScanner));
    this.adapters.set('dropbox', new DropboxLibraryAdapter());
    this.adapters.set('onedrive', new OneDriveLibraryAdapter());
  }
  listProviders() {
    return ['google_drive', 'dropbox', 'onedrive'];
  }
  status(_provider) {
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
    const names = { google_drive: 'Google Drive', dropbox: 'Dropbox', onedrive: 'Microsoft OneDrive' };
    const info = {
      provider,
      name: names[provider] ?? provider,
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
  console.log('=== RUNNING T8.1 EXTERNAL LIBRARY INTEGRATION SPIKE (Regression) ===');
  const storage = new MemoryExternalLibraryStorage();
  const repository = new DefaultExternalLibraryRepository(storage);

  const mockFileScanner = {
    async scanDirectory(dir) {
      return [
        { name: 'Domain Driven Design.epub', path: `${dir}/Domain Driven Design.epub`, size: 1048576 },
        { name: 'Microservices.pdf', path: `${dir}/Microservices.pdf`, size: 2097152 },
        { name: 'Summary.md', path: `${dir}/Summary.md`, size: 4096 },
        { name: 'Notes.txt', path: `${dir}/Notes.txt`, size: 1024 },
        { name: 'Music.mp3', path: `${dir}/Music.mp3`, size: 5000000 }, // should be filtered out
      ];
    },
  };

  const connector = new CompositeExternalLibraryConnector({
    repository,
    fileScanner: mockFileScanner,
  });

  // 1. Providers — must be google_drive + dropbox + onedrive
  const providers = connector.listProviders();
  assert.deepEqual(providers, ['google_drive', 'dropbox', 'onedrive']);
  console.log('1. Providers check passed:', providers);

  // 2. Initial state
  const initial = await connector.getAllProvidersInfo();
  assert.equal(initial.google_drive.status, 'unlinked');
  assert.equal(initial.dropbox.status, 'unlinked');
  assert.equal(initial.onedrive.status, 'unlinked');
  console.log('2. Initial unlinked state verified');

  // 3. Test Connection Google Drive
  const driveTest = await connector.testConnection('google_drive', { folderPath: 'C:/Users/Drive' });
  assert.equal(driveTest.success, true);
  console.log('3. Google Drive test connection passed:', driveTest.message);

  // 4. Link Google Drive (folder-first)
  const driveLinked = await connector.link('google_drive', { folderPath: 'C:/Users/Drive' });
  assert.equal(driveLinked.status, 'linked');
  assert.equal(driveLinked.itemCount, 4); // epub, pdf, md, txt (mp3 filtered out)
  console.log('4. Google Drive linked:', driveLinked.itemCount, 'documents detected');

  // 5. Pull catalog
  const driveDocs = await connector.pullCatalog('google_drive');
  assert.equal(driveDocs.length, 4);
  assert.equal(driveDocs[0].title, 'Domain Driven Design');
  assert.equal(driveDocs[0].formatHint, 'epub');
  console.log('5. Google Drive catalog pull verified (non-book files like mp3 filtered)');

  // 6. Test Connection Dropbox
  const dropboxTest = await connector.testConnection('dropbox', { apiKey: 'xxx' });
  assert.equal(dropboxTest.success, true);
  console.log('6a. Dropbox test connection passed:', dropboxTest.message);

  // 6b. Link Dropbox (sample mode with placeholder key 'xxx')
  const dropboxLinked = await connector.link('dropbox', { apiKey: 'xxx' });
  assert.equal(dropboxLinked.status, 'linked');
  assert.equal(dropboxLinked.config.apiKey, 'xxx');
  const dropboxDocs = await connector.pullCatalog('dropbox');
  assert.equal(dropboxDocs.length, 2);
  console.log('6b. Dropbox linked & catalog pulled:', dropboxDocs.length, 'books');

  // 7. Unlink Google Drive — Dropbox must remain linked
  await connector.unlink('google_drive');
  const postUnlinkDrive = await connector.getProviderInfo('google_drive');
  assert.equal(postUnlinkDrive.status, 'unlinked');
  const dropboxStillLinked = await connector.getProviderInfo('dropbox');
  assert.equal(dropboxStillLinked.status, 'linked');
  console.log('7. Unlink Google Drive verified (isolated per provider, non-destructive)');

  console.log('\n>>> ALL T8.1 EXTERNAL LIBRARY CONNECTOR REGRESSION TESTS PASSED! <<<');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
