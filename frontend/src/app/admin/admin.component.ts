import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import {
  Account,
  ApiService,
  CatalogCategory,
  Device,
  OrderModeName,
  Preset,
  PresetBody,
  ProvisionResult,
} from '../api.service';

interface PresetEditor {
  id: string | null;
  name: string;
  mode: OrderModeName;
  roulettePercent: number;
  randomCategory: string;
  selected: Set<string>;
}

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
        <input class="form-control mb-3" type="password" placeholder="Password" [(ngModel)]="loginPass" name="p" />
        <button class="btn btn-primary w-100" [disabled]="busy()">Sign in</button>
      </form>
    </div>

    <!-- dashboard -->
    <div *ngIf="loggedIn()">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h4 m-0">Admin <small class="text-secondary fs-6">· {{ account()?.name }}</small></h1>
        <button class="btn btn-outline-secondary btn-sm" (click)="logout()">Sign out</button>
      </div>

      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>

      <div *ngIf="lastProvisioned() as p" class="alert alert-warning">
        <strong>Device provisioned — copy now (shown once):</strong>
        <div class="mt-2 font-monospace small">
          <div>username: {{ p.credentials.username }}</div>
          <div>password: {{ p.credentials.password }}</div>
          <div>guest URL: {{ guestUrl(p.device.topicId) }}</div>
        </div>
        <button class="btn btn-sm btn-outline-dark mt-2" (click)="lastProvisioned.set(null)">Dismiss</button>
      </div>

      <!-- presets -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">Presets</span>
          <button class="btn btn-sm btn-primary" (click)="newPreset()">New preset</button>
        </div>
        <div class="card-body">
          <!-- editor -->
          <div *ngIf="editor() as ed" class="border rounded p-3 mb-3 bg-body-tertiary">
            <div class="row g-2 mb-2">
              <div class="col-sm-6">
                <label class="form-label small mb-0">Name</label>
                <input class="form-control" [(ngModel)]="ed.name" name="pn" />
              </div>
              <div class="col-sm-6">
                <label class="form-label small mb-0">Order mode</label>
                <select class="form-select" [(ngModel)]="ed.mode" name="pm">
                  <option value="fixed">fixed</option>
                  <option value="random_article">random_article</option>
                  <option value="russian_roulette">russian_roulette</option>
                </select>
              </div>
            </div>

            <div class="row g-2 mb-2">
              <div class="col-sm-6" *ngIf="ed.mode === 'russian_roulette'">
                <label class="form-label small mb-0">Roulette % (0–100)</label>
                <input class="form-control" type="number" min="0" max="100" [(ngModel)]="ed.roulettePercent" name="pr" />
              </div>
              <div class="col-sm-6" *ngIf="ed.mode === 'random_article'">
                <label class="form-label small mb-0">Random category</label>
                <select class="form-select" [(ngModel)]="ed.randomCategory" name="pc">
                  <option value="">(none)</option>
                  <option *ngFor="let c of categories()" [value]="c.name">{{ c.name }}</option>
                </select>
              </div>
            </div>

            <label class="form-label small mb-1">Articles</label>
            <div *ngFor="let c of categories()" class="mb-2">
              <div class="fw-semibold small">{{ c.name }}</div>
              <div class="d-flex flex-wrap gap-2">
                <div class="form-check" *ngFor="let a of c.articles">
                  <input
                    class="form-check-input"
                    type="checkbox"
                    [id]="'a-' + a._id"
                    [checked]="ed.selected.has(a._id)"
                    (change)="toggleArticle(ed, a._id)"
                  />
                  <label class="form-check-label small" [for]="'a-' + a._id">{{ a.name }}</label>
                </div>
              </div>
            </div>

            <div class="mt-2">
              <button class="btn btn-sm btn-primary" (click)="savePreset(ed)" [disabled]="busy() || !ed.name">Save</button>
              <button class="btn btn-sm btn-outline-secondary ms-2" (click)="editor.set(null)">Cancel</button>
            </div>
          </div>

          <ul class="list-group" *ngIf="presets().length; else noPresets">
            <li *ngFor="let p of presets()" class="list-group-item d-flex justify-content-between align-items-center">
              <span>
                <strong>{{ p.name }}</strong>
                <span class="badge text-bg-light ms-2">{{ p.orderMode.mode }}</span>
                <span class="text-secondary small ms-2">{{ p.articles.length }} article(s)</span>
              </span>
              <span>
                <button class="btn btn-sm btn-outline-secondary" (click)="editPreset(p)">Edit</button>
                <button class="btn btn-sm btn-outline-danger ms-1" (click)="removePreset(p)">Delete</button>
              </span>
            </li>
          </ul>
          <ng-template #noPresets><p class="text-secondary m-0">No presets yet.</p></ng-template>
        </div>
      </section>

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

          <div *ngFor="let d of devices()" class="border rounded p-2 mb-2">
            <div class="d-flex justify-content-between align-items-center">
              <span>
                <strong>{{ d.label || '—' }}</strong>
                <a class="ms-2 small" [href]="guestUrl(d.topicId)" target="_blank">{{ d.topicId }}</a>
                <span class="text-secondary small ms-2">{{ d.assignedPresetIds.length }} preset(s)</span>
              </span>
              <span>
                <button class="btn btn-sm btn-outline-secondary" (click)="toggleAssign(d)">Presets</button>
                <button class="btn btn-sm btn-outline-danger ms-1" (click)="removeDevice(d)">Delete</button>
              </span>
            </div>
            <div *ngIf="assigning() === d.topicId" class="mt-2 border-top pt-2">
              <div class="form-check" *ngFor="let p of presets()">
                <input
                  class="form-check-input"
                  type="checkbox"
                  [id]="'dp-' + d.topicId + '-' + p.id"
                  [checked]="assignSel.has(p.id)"
                  (change)="toggleAssignPreset(p.id)"
                />
                <label class="form-check-label" [for]="'dp-' + d.topicId + '-' + p.id">{{ p.name }}</label>
              </div>
              <p *ngIf="!presets().length" class="text-secondary small">Create presets first.</p>
              <button class="btn btn-sm btn-primary mt-1" (click)="saveAssign(d)" [disabled]="busy()">Save</button>
              <button class="btn btn-sm btn-outline-secondary ms-1 mt-1" (click)="assigning.set(null)">Cancel</button>
            </div>
          </div>
          <p *ngIf="!devices().length" class="text-secondary m-0">No devices yet.</p>
        </div>
      </section>

      <!-- admins -->
      <section class="card">
        <div class="card-header fw-semibold">Admin users</div>
        <div class="card-body">
          <form class="row g-2 mb-3" (ngSubmit)="addAdmin()">
            <div class="col-sm-4"><input class="form-control" placeholder="Username" [(ngModel)]="newAdminUser" name="au" /></div>
            <div class="col-sm-5"><input class="form-control" type="password" placeholder="Password (min 8)" [(ngModel)]="newAdminPass" name="ap" /></div>
            <div class="col-sm-3 d-grid"><button class="btn btn-primary" [disabled]="busy() || !newAdminUser || newAdminPass.length < 8">Add</button></div>
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

  account = signal<Account | null>(null);
  categories = signal<CatalogCategory[]>([]);
  presets = signal<Preset[]>([]);
  devices = signal<Device[]>([]);
  admins = signal<string[]>([]);
  lastProvisioned = signal<ProvisionResult | null>(null);

  editor = signal<PresetEditor | null>(null);

  assigning = signal<string | null>(null);
  assignSel = new Set<string>();

  newMac = '';
  newLabel = '';
  newAdminUser = '';
  newAdminPass = '';

  ngOnInit(): void {
    if (this.loggedIn()) this.refresh();
  }

  login(): void {
    this.error.set('');
    this.api.setAuth(this.loginUser, this.loginPass);
    this.busy.set(true);
    this.api.adminGetAccount().subscribe({
      next: (r) => {
        this.busy.set(false);
        this.account.set(r.account);
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
    this.account.set(null);
    this.presets.set([]);
    this.devices.set([]);
    this.admins.set([]);
    this.editor.set(null);
  }

  refresh(): void {
    this.api.adminGetAccount().subscribe({ next: (r) => this.account.set(r.account), error: (e) => this.onErr(e) });
    this.api.adminGetCatalog().subscribe({ next: (r) => this.categories.set(r.categories), error: (e) => this.onErr(e) });
    this.api.adminListPresets().subscribe({ next: (r) => this.presets.set(r.presets), error: (e) => this.onErr(e) });
    this.api.adminListDevices().subscribe({ next: (r) => this.devices.set(r.devices), error: (e) => this.onErr(e) });
    this.api.adminListAdmins().subscribe({ next: (r) => this.admins.set(r.admins), error: (e) => this.onErr(e) });
  }

  // ---- presets ----

  newPreset(): void {
    this.editor.set({
      id: null,
      name: '',
      mode: 'fixed',
      roulettePercent: 50,
      randomCategory: '',
      selected: new Set<string>(),
    });
  }

  editPreset(p: Preset): void {
    this.editor.set({
      id: p.id,
      name: p.name,
      mode: p.orderMode.mode,
      roulettePercent: p.orderMode.roulette_percent ?? 50,
      randomCategory: p.orderMode.random_category ?? '',
      selected: new Set(p.articles.map((a) => a._id)),
    });
  }

  toggleArticle(ed: PresetEditor, id: string): void {
    if (ed.selected.has(id)) ed.selected.delete(id);
    else ed.selected.add(id);
  }

  savePreset(ed: PresetEditor): void {
    const orderMode: PresetBody['orderMode'] = { mode: ed.mode };
    if (ed.mode === 'russian_roulette') orderMode.roulette_percent = Number(ed.roulettePercent);
    if (ed.mode === 'random_article' && ed.randomCategory) orderMode.random_category = ed.randomCategory;
    const body: PresetBody = {
      name: ed.name,
      orderMode,
      articles: [...ed.selected].map((_id) => ({ _id, combinedWith: [] })),
    };
    const req = ed.id ? this.api.adminUpdatePreset(ed.id, body) : this.api.adminCreatePreset(body);
    this.run(req, () => {
      this.editor.set(null);
      this.refresh();
    });
  }

  removePreset(p: Preset): void {
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    this.run(this.api.adminDeletePreset(p.id), () => this.refresh());
  }

  // ---- devices ----

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

  toggleAssign(d: Device): void {
    if (this.assigning() === d.topicId) {
      this.assigning.set(null);
      return;
    }
    this.assignSel = new Set(d.assignedPresetIds);
    this.assigning.set(d.topicId);
  }

  toggleAssignPreset(id: string): void {
    if (this.assignSel.has(id)) this.assignSel.delete(id);
    else this.assignSel.add(id);
  }

  saveAssign(d: Device): void {
    this.run(this.api.adminSetDevicePresets(d.topicId, [...this.assignSel]), () => {
      this.assigning.set(null);
      this.refresh();
    });
  }

  // ---- admins ----

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

  // ---- helpers ----

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
