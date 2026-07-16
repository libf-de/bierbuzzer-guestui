import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import { ApiService, Article, Device, ProvisionResult } from '../api.service';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- login -->
    <div *ngIf="!loggedIn()" class="mx-auto" style="max-width: 24rem;">
      <h1 class="h4 mb-3">Admin login</h1>
      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
      <form (ngSubmit)="login()">
        <input class="form-control mb-2" placeholder="Username" [(ngModel)]="loginUser" name="u" />
        <input
          class="form-control mb-3"
          type="password"
          placeholder="Password"
          [(ngModel)]="loginPass"
          name="p"
        />
        <button class="btn btn-primary w-100" [disabled]="busy()">Sign in</button>
      </form>
    </div>

    <!-- dashboard -->
    <div *ngIf="loggedIn()">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h4 m-0">Admin</h1>
        <button class="btn btn-outline-secondary btn-sm" (click)="logout()">Sign out</button>
      </div>

      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>

      <!-- one-time credential reveal -->
      <div *ngIf="lastProvisioned() as p" class="alert alert-warning">
        <strong>Device provisioned — copy these now (shown once):</strong>
        <div class="mt-2 font-monospace small">
          <div>topicId: {{ p.device.topicId }}</div>
          <div>username: {{ p.credentials.username }}</div>
          <div>password: {{ p.credentials.password }}</div>
          <div>guest URL: {{ guestUrl(p.device.topicId) }}</div>
        </div>
        <button class="btn btn-sm btn-outline-dark mt-2" (click)="lastProvisioned.set(null)">
          Dismiss
        </button>
      </div>

      <!-- devices -->
      <section class="card mb-4">
        <div class="card-header fw-semibold">Devices</div>
        <div class="card-body">
          <form class="row g-2 mb-3" (ngSubmit)="provision()">
            <div class="col-sm-5">
              <input class="form-control" placeholder="MAC (AA:BB:CC:DD:EE:FF)" [(ngModel)]="newMac" name="mac" />
            </div>
            <div class="col-sm-4">
              <input class="form-control" placeholder="Label (optional)" [(ngModel)]="newLabel" name="label" />
            </div>
            <div class="col-sm-3 d-grid">
              <button class="btn btn-primary" [disabled]="busy() || !newMac">Provision</button>
            </div>
          </form>

          <table class="table table-sm align-middle mb-0" *ngIf="devices().length; else noDevices">
            <thead>
              <tr><th>Label</th><th>MAC</th><th>topicId</th><th></th></tr>
            </thead>
            <tbody>
              <tr *ngFor="let d of devices()">
                <td>{{ d.label || '—' }}</td>
                <td class="font-monospace small">{{ d.mac }}</td>
                <td class="font-monospace small text-truncate" style="max-width: 12rem;">
                  <a [href]="guestUrl(d.topicId)" target="_blank">{{ d.topicId }}</a>
                </td>
                <td class="text-end">
                  <button class="btn btn-sm btn-outline-danger" (click)="removeDevice(d)">Delete</button>
                </td>
              </tr>
            </tbody>
          </table>
          <ng-template #noDevices><p class="text-secondary m-0">No devices yet.</p></ng-template>
        </div>
      </section>

      <!-- articles -->
      <section class="card mb-4">
        <div class="card-header fw-semibold">Menu (article whitelist)</div>
        <div class="card-body">
          <form class="row g-2 mb-3" (ngSubmit)="addArticle()">
            <div class="col-sm-4">
              <input class="form-control" placeholder="id (e.g. pils)" [(ngModel)]="newArtId" name="aid" />
            </div>
            <div class="col-sm-5">
              <input class="form-control" placeholder="Name (e.g. Pilsner)" [(ngModel)]="newArtName" name="aname" />
            </div>
            <div class="col-sm-3 d-grid">
              <button class="btn btn-primary" [disabled]="busy() || !newArtId || !newArtName">Add</button>
            </div>
          </form>
          <ul class="list-group" *ngIf="articles().length; else noArticles">
            <li *ngFor="let a of articles()" class="list-group-item d-flex justify-content-between align-items-center">
              <span>{{ a.name }} <code class="ms-2">{{ a.id }}</code></span>
              <button class="btn btn-sm btn-outline-danger" (click)="removeArticle(a)">Delete</button>
            </li>
          </ul>
          <ng-template #noArticles><p class="text-secondary m-0">No articles yet.</p></ng-template>
        </div>
      </section>

      <!-- admins -->
      <section class="card">
        <div class="card-header fw-semibold">Admin users</div>
        <div class="card-body">
          <form class="row g-2 mb-3" (ngSubmit)="addAdmin()">
            <div class="col-sm-4">
              <input class="form-control" placeholder="Username" [(ngModel)]="newAdminUser" name="au" />
            </div>
            <div class="col-sm-5">
              <input class="form-control" type="password" placeholder="Password (min 8)" [(ngModel)]="newAdminPass" name="ap" />
            </div>
            <div class="col-sm-3 d-grid">
              <button class="btn btn-primary" [disabled]="busy() || !newAdminUser || newAdminPass.length < 8">Add</button>
            </div>
          </form>
          <ul class="list-group">
            <li *ngFor="let name of admins()" class="list-group-item d-flex justify-content-between align-items-center">
              {{ name }}
              <button class="btn btn-sm btn-outline-danger" (click)="removeAdmin(name)">Delete</button>
            </li>
          </ul>
        </div>
      </section>
    </div>
  `,
})
export class AdminComponent implements OnInit {
  private api = inject(ApiService);

  loggedIn = computed(() => this.api.authToken() !== null);
  busy = signal(false);
  error = signal('');

  loginUser = '';
  loginPass = '';

  devices = signal<Device[]>([]);
  articles = signal<Article[]>([]);
  admins = signal<string[]>([]);
  lastProvisioned = signal<ProvisionResult | null>(null);

  newMac = '';
  newLabel = '';
  newArtId = '';
  newArtName = '';
  newAdminUser = '';
  newAdminPass = '';

  ngOnInit(): void {
    if (this.loggedIn()) this.refresh();
  }

  login(): void {
    this.error.set('');
    this.api.setAuth(this.loginUser, this.loginPass);
    this.busy.set(true);
    // verify creds by loading; roll back auth on failure
    this.api.adminListDevices().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.devices.set(r.devices);
        this.loginPass = '';
        this.refresh();
      },
      error: (e) => {
        this.busy.set(false);
        this.api.clearAuth();
        this.error.set(e.status === 401 ? 'Invalid credentials' : e.error?.error ?? 'Login failed');
      },
    });
  }

  logout(): void {
    this.api.clearAuth();
    this.devices.set([]);
    this.articles.set([]);
    this.admins.set([]);
  }

  refresh(): void {
    this.api.adminListDevices().subscribe({ next: (r) => this.devices.set(r.devices), error: (e) => this.onErr(e) });
    this.api.adminListArticles().subscribe({ next: (r) => this.articles.set(r.articles), error: (e) => this.onErr(e) });
    this.api.adminListAdmins().subscribe({ next: (r) => this.admins.set(r.admins), error: (e) => this.onErr(e) });
  }

  provision(): void {
    this.run(this.api.adminCreateDevice(this.newMac, this.newLabel), (res) => {
      this.lastProvisioned.set(res);
      this.newMac = '';
      this.newLabel = '';
      this.refresh();
    });
  }

  removeDevice(d: Device): void {
    if (!confirm(`Delete device ${d.label || d.topicId}?`)) return;
    this.run(this.api.adminDeleteDevice(d.topicId), () => this.refresh());
  }

  addArticle(): void {
    this.run(this.api.adminCreateArticle(this.newArtId, this.newArtName), () => {
      this.newArtId = '';
      this.newArtName = '';
      this.refresh();
    });
  }

  removeArticle(a: Article): void {
    this.run(this.api.adminDeleteArticle(a.id), () => this.refresh());
  }

  addAdmin(): void {
    this.run(this.api.adminCreateAdmin(this.newAdminUser, this.newAdminPass), () => {
      this.newAdminUser = '';
      this.newAdminPass = '';
      this.refresh();
    });
  }

  removeAdmin(name: string): void {
    if (!confirm(`Delete admin ${name}?`)) return;
    this.run(this.api.adminDeleteAdmin(name), () => this.refresh());
  }

  guestUrl(topicId: string): string {
    return `${location.origin}/g/${topicId}`;
  }

  private run<T>(obs: Observable<T>, ok: (v: T) => void): void {
    this.busy.set(true);
    this.error.set('');
    obs.subscribe({
      next: (v) => {
        this.busy.set(false);
        ok(v);
      },
      error: (e) => {
        this.busy.set(false);
        this.onErr(e);
      },
    });
  }

  private onErr(e: any): void {
    if (e.status === 401) {
      this.api.clearAuth();
      this.error.set('Session expired — sign in again');
      return;
    }
    this.error.set(e.error?.error ?? 'Request failed');
  }
}
