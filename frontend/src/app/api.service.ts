import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export type OrderModeName = 'fixed' | 'random_article' | 'russian_roulette';

export interface OrderMode {
  mode: OrderModeName;
  roulette_percent?: number;
  random_category?: string;
}

export interface ArticleRef {
  _id: string;
  combinedWith: string[];
}

export interface CatalogArticle {
  _id: string;
  name: string;
}

export interface CatalogCategory {
  name: string;
  articles: CatalogArticle[];
}

export interface Preset {
  id: string;
  accountId?: string;
  name: string;
  orderMode: OrderMode;
  articles: ArticleRef[];
  createdAt?: number;
}

export interface Device {
  topicId: string;
  username: string;
  mac: string;
  label?: string;
  accountId: string;
  assignedPresetIds: string[];
  createdAt: number;
}

export interface DeviceStatus {
  state: 'online' | 'offline';
  ip?: string;
  battery_mv?: number;
  rssi?: number;
  at: number;
}

export interface AckState {
  rev?: number | string;
  ok: boolean;
  orderMode: OrderMode | null;
  articles: ArticleRef[] | null;
  rejected: Record<string, string>;
  at: number;
}

export interface GuestPreset {
  id: string;
  name: string;
  orderMode: OrderMode;
  articles: ArticleRef[];
}

export interface GuestDeviceView {
  topicId: string;
  label: string | null;
  presets: GuestPreset[];
  applied: AckState | null;
  status: DeviceStatus | null;
}

export interface SelectResult {
  presetId: string;
  confirmed: boolean;
  ack: AckState | null;
}

export interface ProvisionResult {
  device: Device;
  credentials: { username: string; password: string };
}

export interface PresetBody {
  name: string;
  orderMode: OrderMode;
  articles: ArticleRef[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  /**
   * External apiKey (== accountId), used as a Bearer token, persisted for the
   * tab session. Admin surface ONLY — never exposed to the guest UI/API.
   */
  readonly authToken = signal<string | null>(sessionStorage.getItem('adminAuth'));

  // ---- guest ----

  getDevice(topicId: string): Observable<GuestDeviceView> {
    return this.http.get<GuestDeviceView>(`${this.base}/devices/${topicId}`);
  }

  selectPreset(topicId: string, presetId: string): Observable<SelectResult> {
    return this.http.post<SelectResult>(`${this.base}/devices/${topicId}/select`, { presetId });
  }

  // ---- admin auth (external) ----

  /** Exchange credentials for an apiKey via the backend's external-auth proxy. */
  login(username: string, password: string): Observable<{ apiKey: string }> {
    return this.http.post<{ apiKey: string }>(`${this.base}/auth/login`, { username, password });
  }

  setToken(apiKey: string): void {
    this.authToken.set(apiKey);
    sessionStorage.setItem('adminAuth', apiKey);
  }

  clearAuth(): void {
    this.authToken.set(null);
    sessionStorage.removeItem('adminAuth');
  }

  private opts(): { headers: HttpHeaders } {
    return { headers: new HttpHeaders({ Authorization: `Bearer ${this.authToken() ?? ''}` }) };
  }

  // ---- admin: account + catalog ----

  /** Account name (from external checkLogin). Never returns the apiKey. */
  adminGetAccount(): Observable<{ name: string | null }> {
    return this.http.get<{ name: string | null }>(`${this.base}/admin/account`, this.opts());
  }

  adminGetCatalog(): Observable<{ categories: CatalogCategory[] }> {
    return this.http.get<{ categories: CatalogCategory[] }>(`${this.base}/admin/catalog`, this.opts());
  }

  // ---- admin: presets ----

  adminListPresets(): Observable<{ presets: Preset[] }> {
    return this.http.get<{ presets: Preset[] }>(`${this.base}/admin/presets`, this.opts());
  }

  adminCreatePreset(body: PresetBody): Observable<{ preset: Preset }> {
    return this.http.post<{ preset: Preset }>(`${this.base}/admin/presets`, body, this.opts());
  }

  adminUpdatePreset(id: string, body: PresetBody): Observable<{ preset: Preset }> {
    return this.http.put<{ preset: Preset }>(`${this.base}/admin/presets/${id}`, body, this.opts());
  }

  adminDeletePreset(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/presets/${id}`, this.opts());
  }

  // ---- admin: devices ----

  adminListDevices(): Observable<{ devices: Device[] }> {
    return this.http.get<{ devices: Device[] }>(`${this.base}/admin/devices`, this.opts());
  }

  adminCreateDevice(mac: string, label?: string): Observable<ProvisionResult> {
    return this.http.post<ProvisionResult>(
      `${this.base}/admin/devices`,
      { mac, label: label || undefined },
      this.opts(),
    );
  }

  adminDeleteDevice(topicId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/devices/${topicId}`, this.opts());
  }

  adminSetDevicePresets(topicId: string, presetIds: string[]): Observable<{ device: Device }> {
    return this.http.put<{ device: Device }>(
      `${this.base}/admin/devices/${topicId}/presets`,
      { presetIds },
      this.opts(),
    );
  }
}
