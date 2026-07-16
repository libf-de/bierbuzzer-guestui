import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface Article {
  id: string;
  name: string;
  createdAt: number;
}

export interface Device {
  topicId: string;
  username: string;
  mac: string;
  label?: string;
  createdAt: number;
}

export interface DeviceState {
  articleId: string;
  at: number;
  source: 'ack' | 'status';
}

export interface GuestDeviceView {
  topicId: string;
  label: string | null;
  currentArticle: DeviceState | null;
}

export interface SetArticleResult {
  articleId: string;
  confirmed: boolean;
  state: DeviceState | null;
}

export interface ProvisionResult {
  device: Device;
  credentials: { username: string; password: string };
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);
  private base = '/api';

  /** Basic-auth token (base64 "user:pass"), persisted for the tab session. */
  readonly authToken = signal<string | null>(sessionStorage.getItem('adminAuth'));

  // ---- guest ----

  listArticles(): Observable<{ articles: Article[] }> {
    return this.http.get<{ articles: Article[] }>(`${this.base}/articles`);
  }

  getDevice(topicId: string): Observable<GuestDeviceView> {
    return this.http.get<GuestDeviceView>(`${this.base}/devices/${topicId}`);
  }

  setArticle(topicId: string, articleId: string): Observable<SetArticleResult> {
    return this.http.post<SetArticleResult>(`${this.base}/devices/${topicId}/article`, {
      articleId,
    });
  }

  // ---- admin auth ----

  setAuth(username: string, password: string): void {
    const token = btoa(`${username}:${password}`);
    this.authToken.set(token);
    sessionStorage.setItem('adminAuth', token);
  }

  clearAuth(): void {
    this.authToken.set(null);
    sessionStorage.removeItem('adminAuth');
  }

  private authHeaders(): HttpHeaders {
    return new HttpHeaders({ Authorization: `Basic ${this.authToken() ?? ''}` });
  }

  // ---- admin: devices ----

  adminListDevices(): Observable<{ devices: Device[] }> {
    return this.http.get<{ devices: Device[] }>(`${this.base}/admin/devices`, {
      headers: this.authHeaders(),
    });
  }

  adminCreateDevice(mac: string, label?: string): Observable<ProvisionResult> {
    return this.http.post<ProvisionResult>(
      `${this.base}/admin/devices`,
      { mac, label: label || undefined },
      { headers: this.authHeaders() },
    );
  }

  adminDeleteDevice(topicId: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/devices/${topicId}`, {
      headers: this.authHeaders(),
    });
  }

  // ---- admin: articles ----

  adminListArticles(): Observable<{ articles: Article[] }> {
    return this.http.get<{ articles: Article[] }>(`${this.base}/admin/articles`, {
      headers: this.authHeaders(),
    });
  }

  adminCreateArticle(id: string, name: string): Observable<{ article: Article }> {
    return this.http.post<{ article: Article }>(
      `${this.base}/admin/articles`,
      { id, name },
      { headers: this.authHeaders() },
    );
  }

  adminDeleteArticle(id: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/articles/${id}`, {
      headers: this.authHeaders(),
    });
  }

  // ---- admin: admins ----

  adminListAdmins(): Observable<{ admins: string[] }> {
    return this.http.get<{ admins: string[] }>(`${this.base}/admin/admins`, {
      headers: this.authHeaders(),
    });
  }

  adminCreateAdmin(username: string, password: string): Observable<{ username: string }> {
    return this.http.post<{ username: string }>(
      `${this.base}/admin/admins`,
      { username, password },
      { headers: this.authHeaders() },
    );
  }

  adminDeleteAdmin(username: string): Observable<void> {
    return this.http.delete<void>(`${this.base}/admin/admins/${username}`, {
      headers: this.authHeaders(),
    });
  }
}
