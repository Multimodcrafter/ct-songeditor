export type SongCategory = {
  id: number;
  name: string;
  nameTranslated: string;
  campusId: number | null;
  sortKey: number;
};

export type Arrangement = {
  id: number;
  name: string;
  isDefault: boolean;
  key: string | null;
  tempo: number | null;
  beat: string | null;
  description: string | null;
  duration: number | null;
};

export type Song = {
  id: number;
  name: string;
  author: string | null;
  copyright: string | null;
  ccli?: string | null;
  category: SongCategory;
  arrangements?: Arrangement[];
};

export type ChurchToolsFile = {
  id: number;
  domainType: string;
  domainId: string;
  name: string;
  filename: string;
  fileUrl: string;
  relativeUrl?: string;
  type?: string;
  size?: number | null;
  meta?: {
    createdDate?: string;
    modifiedDate?: string;
  };
};

type ApiEnvelope<T> = {
  data: T;
  meta?: {
    pagination?: {
      current?: number;
      lastPage?: number;
      limit?: number;
      total?: number;
    };
  };
};

export type ChurchToolsConfig = {
  loginToken: string;
};

export const CHURCHTOOLS_ORIGIN = 'https://nl.church.tools';
const PROXY_BASE = '/ct-proxy';

export class ChurchToolsApi {
  private readonly token: string;

  constructor(config: ChurchToolsConfig) {
    this.token = config.loginToken.trim();
  }

  private authHeaders(): HeadersInit {
    return this.token ? { Authorization: `Login ${this.token}` } : {};
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!this.token) {
      throw new Error('Enter a ChurchTools login token to connect to nl.church.tools.');
    }

    const headers = new Headers(init.headers);
    headers.set('Authorization', `Login ${this.token}`);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${PROXY_BASE}/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`ChurchTools API ${response.status}: ${body || response.statusText}`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  async getSongs(query = ''): Promise<Song[]> {
    const songs: Song[] = [];
    const limit = 100;
    let page = 1;
    let lastPage = 1;

    do {
      const params = new URLSearchParams();
      params.append('include', 'arrangements');
      params.set('limit', String(limit));
      params.set('page', String(page));
      if (query.trim()) params.set('query', query.trim());

      const result = await this.request<ApiEnvelope<Song[]>>(`/songs?${params.toString()}`);
      songs.push(...result.data);
      lastPage = result.meta?.pagination?.lastPage ?? page;
      page += 1;
    } while (page <= lastPage);

    return songs;
  }

  async getArrangements(songId: number): Promise<Arrangement[]> {
    const result = await this.request<ApiEnvelope<Arrangement[]>>(`/songs/${songId}/arrangements`);
    return result.data;
  }

  async getArrangementFiles(arrangementId: number): Promise<ChurchToolsFile[]> {
    const result = await this.request<ApiEnvelope<ChurchToolsFile[]>>(
      `/files/song_arrangement/${arrangementId}`,
    );
    return result.data;
  }

  async downloadFile(file: ChurchToolsFile): Promise<ArrayBuffer> {
    if (!this.token) {
      throw new Error('Enter a ChurchTools login token to download arrangement files.');
    }

    const upstream = new URL(file.fileUrl, CHURCHTOOLS_ORIGIN);
    if (upstream.origin !== CHURCHTOOLS_ORIGIN) {
      throw new Error(`Refusing to download a file from unexpected origin ${upstream.origin}.`);
    }

    const response = await fetch(`${PROXY_BASE}${upstream.pathname}${upstream.search}`, {
      credentials: 'same-origin',
      headers: this.authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Could not download ${file.name}: ${response.status} ${response.statusText}`);
    }
    return response.arrayBuffer();
  }

  async uploadArrangementFile(
    arrangementId: number,
    filename: string,
    bytes: Uint8Array,
  ): Promise<ChurchToolsFile> {
    const data = new FormData();
    const ownedBytes = new Uint8Array(bytes);
    const blob = new Blob([ownedBytes.buffer], { type: 'text/plain;charset=utf-8' });
    data.append('files[]', blob, filename);
    const result = await this.request<ApiEnvelope<ChurchToolsFile[]>>(
      `/files/song_arrangement/${arrangementId}`,
      { method: 'POST', body: data },
    );
    const uploaded = result.data[0];
    if (!uploaded) throw new Error('ChurchTools did not return the uploaded file.');
    return uploaded;
  }

  async deleteFile(fileId: number): Promise<void> {
    await this.request<void>(`/files/${fileId}`, { method: 'DELETE' });
  }
}

export function isSngFile(file: ChurchToolsFile): boolean {
  return file.name.toLowerCase().endsWith('.sng') || file.filename.toLowerCase().endsWith('.sng');
}

export function newestFile(files: ChurchToolsFile[]): ChurchToolsFile | undefined {
  return [...files].sort((a, b) => {
    const aDate = Date.parse(a.meta?.modifiedDate ?? a.meta?.createdDate ?? '') || 0;
    const bDate = Date.parse(b.meta?.modifiedDate ?? b.meta?.createdDate ?? '') || 0;
    return bDate - aDate || b.id - a.id;
  })[0];
}
