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

export const CHURCHTOOLS_ORIGIN = 'https://nl.church.tools';
const PROXY_BASE = '/ct-proxy';

export class ChurchToolsApi {
  constructor(private readonly onSessionExpired: () => void = () => {}) {}

  private checkAuthentication(response: Response) {
    if (response.status === 401) {
      this.onSessionExpired();
      throw new Error('Deine Anmeldung ist abgelaufen. Bitte melde dich erneut bei ChurchTools an.');
    }
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(`${PROXY_BASE}/api${path}`, {
      ...init,
      credentials: 'same-origin',
      headers,
    });

    this.checkAuthentication(response);
    if (!response.ok) throw new Error(response.status === 403
      ? 'Du hast für diese Aktion keine Berechtigung in ChurchTools.'
      : `Die ChurchTools-Anfrage ist fehlgeschlagen (Status ${response.status}). Bitte versuche es erneut.`);
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
    const upstream = new URL(file.fileUrl, CHURCHTOOLS_ORIGIN);
    if (upstream.origin !== CHURCHTOOLS_ORIGIN) {
      throw new Error(`Download von einer unerwarteten Adresse abgelehnt: ${upstream.origin}.`);
    }

    const response = await fetch(`${PROXY_BASE}${upstream.pathname}${upstream.search}`, {
      credentials: 'same-origin',
    });
    this.checkAuthentication(response);
    if (!response.ok) {
      throw new Error(`Die Datei „${file.name}“ konnte nicht heruntergeladen werden (Status ${response.status}).`);
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
    if (!uploaded) throw new Error('ChurchTools hat die hochgeladene Datei nicht zurückgegeben.');
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
