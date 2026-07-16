import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Observable } from 'rxjs';
import {
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

interface ProvisionWizard {
  step: 1 | 2 | 3;
  mac: string;
  name: string;
  sel: Set<string>;
}

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <!-- Anmeldung (externe Authentifizierung) -->
    <div *ngIf="!loggedIn()" class="mx-auto" style="max-width: 24rem;">
      <h1 class="h4 mb-3">Admin-Anmeldung</h1>
      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>
      <form (ngSubmit)="login()">
        <input class="form-control mb-2" placeholder="Benutzername" [(ngModel)]="loginUser" name="u" />
        <input class="form-control mb-3" type="password" placeholder="Passwort" [(ngModel)]="loginPass" name="p" />
        <button class="btn btn-primary w-100" [disabled]="busy() || !loginUser || !loginPass">Anmelden</button>
      </form>
    </div>

    <!-- Dashboard -->
    <div *ngIf="loggedIn()">
      <div class="d-flex justify-content-between align-items-center mb-3">
        <h1 class="h4 m-0">
          Admin
          <small class="text-secondary fs-6" *ngIf="accountName()">· {{ accountName() }}</small>
        </h1>
        <button class="btn btn-outline-secondary btn-sm" (click)="logout()">Abmelden</button>
      </div>

      <div *ngIf="error()" class="alert alert-danger">{{ error() }}</div>

      <div *ngIf="lastProvisioned() as p" class="alert alert-warning">
        <strong>Gerät angelegt — jetzt kopieren (nur einmal sichtbar):</strong>
        <div class="mt-2 font-monospace small">
          <div>Benutzername: {{ p.credentials.username }}</div>
          <div>Passwort: {{ p.credentials.password }}</div>
          <div>Gast-URL: {{ guestUrl(p.device.topicId) }}</div>
        </div>
        <button class="btn btn-sm btn-outline-dark mt-2" (click)="lastProvisioned.set(null)">Schließen</button>
      </div>

      <!-- Voreinstellungen -->
      <section class="card mb-4">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">Voreinstellungen</span>
          <button class="btn btn-sm btn-primary" (click)="newPreset()">Neue Voreinstellung</button>
        </div>
        <div class="card-body">
          <div *ngIf="editor() as ed" class="border rounded p-3 mb-3 bg-body-tertiary">
            <div class="row g-2 mb-2">
              <div class="col-sm-6">
                <label class="form-label small mb-0">Name</label>
                <input class="form-control" [(ngModel)]="ed.name" name="pn" />
              </div>
              <div class="col-sm-6">
                <label class="form-label small mb-0">Bestellmodus</label>
                <select class="form-select" [(ngModel)]="ed.mode" name="pm">
                  <option value="fixed">Fest</option>
                  <option value="random_article">Zufälliger Artikel</option>
                  <option value="russian_roulette">Russisches Roulette</option>
                </select>
              </div>
            </div>

            <div class="row g-2 mb-2">
              <div class="col-sm-6" *ngIf="ed.mode === 'russian_roulette'">
                <label class="form-label small mb-0">Roulette % (0–100)</label>
                <input class="form-control" type="number" min="0" max="100" [(ngModel)]="ed.roulettePercent" name="pr" />
              </div>
              <div class="col-sm-6" *ngIf="ed.mode === 'random_article'">
                <label class="form-label small mb-0">Zufällige Kategorie</label>
                <select class="form-select" [(ngModel)]="ed.randomCategory" name="pc">
                  <option value="">(keine)</option>
                  <option *ngFor="let c of categories()" [value]="c.name">{{ c.name }}</option>
                </select>
              </div>
            </div>

            <label class="form-label small mb-1">Artikel</label>
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
              <button class="btn btn-sm btn-primary" (click)="savePreset(ed)" [disabled]="busy() || !ed.name">Speichern</button>
              <button class="btn btn-sm btn-outline-secondary ms-2" (click)="editor.set(null)">Abbrechen</button>
            </div>
          </div>

          <ul class="list-group" *ngIf="presets().length; else noPresets">
            <li *ngFor="let p of presets()" class="list-group-item d-flex justify-content-between align-items-center">
              <span>
                <strong>{{ p.name }}</strong>
                <span class="badge text-bg-light ms-2">{{ modeLabel(p.orderMode.mode) }}</span>
                <span class="text-secondary small ms-2">{{ p.articles.length }} Artikel</span>
              </span>
              <span>
                <button class="btn btn-sm btn-outline-secondary" (click)="editPreset(p)">Bearbeiten</button>
                <button class="btn btn-sm btn-outline-danger ms-1" (click)="removePreset(p)">Löschen</button>
              </span>
            </li>
          </ul>
          <ng-template #noPresets><p class="text-secondary m-0">Noch keine Voreinstellungen.</p></ng-template>
        </div>
      </section>

      <!-- Geräte -->
      <section class="card">
        <div class="card-header d-flex justify-content-between align-items-center">
          <span class="fw-semibold">Geräte</span>
          <button class="btn btn-sm btn-primary" (click)="startWizard()" [disabled]="!!wizard()">Gerät anlegen</button>
        </div>
        <div class="card-body">
          <!-- Assistent (3 Schritte) -->
          <div *ngIf="wizard() as w" class="border rounded p-3 mb-3 bg-body-tertiary">
            <div class="d-flex justify-content-between mb-2">
              <span class="fw-semibold">Neues Gerät</span>
              <span class="small text-secondary">Schritt {{ w.step }} von 3</span>
            </div>

            <div *ngIf="w.step === 1">
              <label class="form-label small mb-0">MAC-Adresse</label>
              <input class="form-control" [(ngModel)]="w.mac" [ngModelOptions]="{ standalone: true }" placeholder="AA:BB:CC:DD:EE:FF" />
              <div class="mt-2">
                <button class="btn btn-sm btn-outline-secondary" (click)="cancelWizard()">Abbrechen</button>
                <button class="btn btn-sm btn-primary ms-1" (click)="wizardNext()" [disabled]="!w.mac.trim()">Weiter</button>
              </div>
            </div>

            <div *ngIf="w.step === 2">
              <label class="form-label small mb-0">Gerätename</label>
              <input class="form-control" [(ngModel)]="w.name" [ngModelOptions]="{ standalone: true }" placeholder="z. B. Tisch 4" />
              <div class="mt-2">
                <button class="btn btn-sm btn-outline-secondary" (click)="wizardBack()">Zurück</button>
                <button class="btn btn-sm btn-primary ms-1" (click)="wizardNext()" [disabled]="!w.name.trim()">Weiter</button>
              </div>
            </div>

            <div *ngIf="w.step === 3">
              <label class="form-label small mb-1">Voreinstellungen zuweisen (optional)</label>
              <div class="form-check" *ngFor="let p of presets()">
                <input class="form-check-input" type="checkbox" [id]="'wz-' + p.id" [checked]="w.sel.has(p.id)" (change)="toggleWizardPreset(p.id)" />
                <label class="form-check-label" [for]="'wz-' + p.id">{{ p.name }}</label>
              </div>
              <p *ngIf="!presets().length" class="text-secondary small">Keine Voreinstellungen vorhanden.</p>
              <div class="mt-2">
                <button class="btn btn-sm btn-outline-secondary" (click)="wizardBack()">Zurück</button>
                <button class="btn btn-sm btn-outline-secondary ms-1" (click)="completeWizard(false)" [disabled]="busy()">Überspringen</button>
                <button class="btn btn-sm btn-primary ms-1" (click)="completeWizard(true)" [disabled]="busy()">Fertig</button>
              </div>
            </div>
          </div>

          <div *ngFor="let d of devices()" class="border rounded p-2 mb-2">
            <div class="d-flex justify-content-between align-items-center">
              <span>
                <strong>{{ d.label || '—' }}</strong>
                <a class="ms-2 small" [href]="guestUrl(d.topicId)" target="_blank">{{ d.topicId }}</a>
                <span class="text-secondary small ms-2">{{ d.assignedPresetIds.length }} Voreinstellung(en)</span>
              </span>
              <span>
                <button class="btn btn-sm btn-outline-secondary" (click)="startRename(d)">Umbenennen</button>
                <button class="btn btn-sm btn-outline-secondary ms-1" (click)="toggleAssign(d)">Voreinstellungen</button>
                <button class="btn btn-sm btn-outline-danger ms-1" (click)="removeDevice(d)">Löschen</button>
              </span>
            </div>

            <div *ngIf="renaming() === d.topicId" class="mt-2 border-top pt-2">
              <div class="input-group input-group-sm">
                <input class="form-control" [(ngModel)]="renameVal" [ngModelOptions]="{ standalone: true }" placeholder="Bezeichnung" />
                <button class="btn btn-primary" (click)="saveRename(d)" [disabled]="busy()">Speichern</button>
                <button class="btn btn-outline-secondary" (click)="renaming.set(null)">Abbrechen</button>
              </div>
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
              <p *ngIf="!presets().length" class="text-secondary small">Zuerst Voreinstellungen erstellen.</p>
              <button class="btn btn-sm btn-primary mt-1" (click)="saveAssign(d)" [disabled]="busy()">Speichern</button>
              <button class="btn btn-sm btn-outline-secondary ms-1 mt-1" (click)="assigning.set(null)">Abbrechen</button>
            </div>
          </div>
          <p *ngIf="!devices().length && !wizard()" class="text-secondary m-0">Noch keine Geräte.</p>
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

  accountName = signal<string | null>(null);
  categories = signal<CatalogCategory[]>([]);
  presets = signal<Preset[]>([]);
  devices = signal<Device[]>([]);
  lastProvisioned = signal<ProvisionResult | null>(null);

  editor = signal<PresetEditor | null>(null);

  assigning = signal<string | null>(null);
  assignSel = new Set<string>();

  renaming = signal<string | null>(null);
  renameVal = '';

  wizard = signal<ProvisionWizard | null>(null);

  ngOnInit(): void {
    if (this.loggedIn()) {
      this.refresh();
      this.maybeStartPendingProvision();
    }
  }

  login(): void {
    this.error.set('');
    this.busy.set(true);
    this.api.login(this.loginUser, this.loginPass).subscribe({
      next: (r) => {
        this.busy.set(false);
        this.api.setToken(r.apiKey);
        this.loginPass = '';
        this.refresh();
        this.maybeStartPendingProvision();
      },
      error: (e) => {
        this.busy.set(false);
        this.error.set(e.status === 401 ? 'Ungültige Anmeldedaten' : e.error?.error ?? 'Anmeldung fehlgeschlagen');
      },
    });
  }

  logout(): void {
    this.api.clearAuth();
    this.accountName.set(null);
    this.presets.set([]);
    this.devices.set([]);
    this.editor.set(null);
  }

  refresh(): void {
    this.api.adminGetAccount().subscribe({ next: (r) => this.accountName.set(r.name), error: (e) => this.onErr(e) });
    this.api.adminGetCatalog().subscribe({ next: (r) => this.categories.set(r.categories), error: (e) => this.onErr(e) });
    this.api.adminListPresets().subscribe({ next: (r) => this.presets.set(r.presets), error: (e) => this.onErr(e) });
    this.api.adminListDevices().subscribe({ next: (r) => this.devices.set(r.devices), error: (e) => this.onErr(e) });
  }

  // ---- Voreinstellungen ----

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
    if (!confirm(`Voreinstellung „${p.name}" löschen?`)) return;
    this.run(this.api.adminDeletePreset(p.id), () => this.refresh());
  }

  // ---- Geräte ----

  // ---- provisioning wizard ----

  /** Resume a provision URL (?provisionMac=...) at step 2, once logged in. */
  private maybeStartPendingProvision(): void {
    const mac = sessionStorage.getItem('pendingProvisionMac');
    if (!mac) return;
    sessionStorage.removeItem('pendingProvisionMac');
    this.startWizard(mac, 2);
  }

  startWizard(mac = '', step: 1 | 2 | 3 = 1): void {
    this.renaming.set(null);
    this.assigning.set(null);
    this.wizard.set({ step, mac, name: '', sel: new Set<string>() });
  }

  cancelWizard(): void {
    this.wizard.set(null);
  }

  wizardNext(): void {
    const w = this.wizard();
    if (!w) return;
    if (w.step === 1 && !w.mac.trim()) return;
    if (w.step === 2 && !w.name.trim()) return;
    this.wizard.set({ ...w, step: (w.step + 1) as 1 | 2 | 3 });
  }

  wizardBack(): void {
    const w = this.wizard();
    if (!w || w.step === 1) return;
    this.wizard.set({ ...w, step: (w.step - 1) as 1 | 2 | 3 });
  }

  toggleWizardPreset(id: string): void {
    const w = this.wizard();
    if (!w) return;
    if (w.sel.has(id)) w.sel.delete(id);
    else w.sel.add(id);
  }

  /** Create the device, then optionally assign the selected presets. */
  completeWizard(withPresets: boolean): void {
    const w = this.wizard();
    if (!w) return;
    this.busy.set(true);
    this.error.set('');
    this.api.adminCreateDevice(w.mac.trim(), w.name.trim() || undefined).subscribe({
      next: (res) => {
        this.lastProvisioned.set(res);
        const ids = withPresets ? [...w.sel] : [];
        if (ids.length) {
          this.api.adminSetDevicePresets(res.device.topicId, ids).subscribe({
            next: () => this.finishWizard(),
            error: (e) => {
              this.busy.set(false);
              this.onErr(e);
            },
          });
        } else {
          this.finishWizard();
        }
      },
      error: (e) => {
        this.busy.set(false);
        this.onErr(e);
      },
    });
  }

  private finishWizard(): void {
    this.busy.set(false);
    this.wizard.set(null);
    this.refresh();
  }

  removeDevice(d: Device): void {
    if (!confirm(`Gerät ${d.label || d.topicId} löschen?`)) return;
    this.run(this.api.adminDeleteDevice(d.topicId), () => this.refresh());
  }

  startRename(d: Device): void {
    this.assigning.set(null);
    this.renameVal = d.label ?? '';
    this.renaming.set(d.topicId);
  }

  saveRename(d: Device): void {
    this.run(this.api.adminRenameDevice(d.topicId, this.renameVal.trim()), () => {
      this.renaming.set(null);
      this.refresh();
    });
  }

  toggleAssign(d: Device): void {
    this.renaming.set(null);
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

  // ---- Helfer ----

  modeLabel(mode: OrderModeName): string {
    return mode === 'fixed' ? 'Fest' : mode === 'random_article' ? 'Zufälliger Artikel' : 'Russisches Roulette';
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
      this.error.set('Sitzung abgelaufen — bitte erneut anmelden');
      return;
    }
    this.error.set(e.error?.error ?? 'Anfrage fehlgeschlagen');
  }
}
